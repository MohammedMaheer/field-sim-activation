"""Durable global duplicate claims and scoped listing indexes.

Existing duplicate history is retained. The earliest record owns each key; only
future duplicates are refused. Downgrade drops claims/indexes without sale loss.
"""
import base64
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from cryptography.fernet import InvalidToken

revision = "018"
down_revision = "017"

INDEXES = {
    "sales_records": [("ix_sale_agent_created", ["agent_id", "created_at"]),
                      ("ix_sale_branch_created", ["branch_id", "created_at"]),
                      ("ix_sale_leader_created", ["leader_id", "created_at"])],
    "kyc_captures": [("ix_capture_status_created", ["status", "created_at"]),
                     ("ix_capture_branch_created", ["branch_id", "created_at"])],
    "notifications": [("ix_notification_user_created", ["user_id", "created_at"])],
}


def ref_hash(value):
    normalized = re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKC", str(value or "")).upper())
    return hashlib.sha256(normalized.encode()).hexdigest() if normalized else ""


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if not inspector.has_table("capture_identity_claims"):
        op.create_table("capture_identity_claims",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("capture_id", sa.String(36), sa.ForeignKey("kyc_captures.id"), nullable=True),
        sa.Column("sale_id", sa.String(36), sa.ForeignKey("sales_records.id"), nullable=True),
        sa.UniqueConstraint("kind", "fingerprint", name="uq_capture_identity_key"),
        sa.CheckConstraint("capture_id IS NOT NULL OR sale_id IS NOT NULL", name="ck_capture_identity_owner"))
    claim_indexes = {row["name"] for row in sa.inspect(connection).get_indexes("capture_identity_claims")}
    for column in ("created_at", "capture_id", "sale_id"):
        name = f"ix_capture_identity_claims_{column}"
        if name not in claim_indexes:
            op.create_index(name, "capture_identity_claims", [column])
    for table, indexes in INDEXES.items():
        existing_indexes = {row["name"] for row in sa.inspect(connection).get_indexes(table)}
        for name, columns in indexes:
            if name not in existing_indexes:
                op.create_index(name, table, columns)

    metadata = sa.MetaData()
    claims = sa.Table("capture_identity_claims", metadata, autoload_with=connection)
    sales = sa.Table("sales_records", metadata, autoload_with=connection)
    captures = sa.Table("kyc_captures", metadata, autoload_with=connection)
    sale_rows = list(connection.execute(sa.select(sales).order_by(sales.c.created_at, sales.c.id)).mappings())
    capture_sale = {row["capture_id"]: row["id"] for row in sale_rows if row["capture_id"]}
    seen = {(row["kind"], row["fingerprint"]): row["created_at"]
            for row in connection.execute(sa.select(claims)).mappings()}

    def add(kind, fingerprint, capture_id=None, sale_id=None, created_at=None):
        if not fingerprint:
            return
        timestamp = created_at or datetime.now(timezone.utc).replace(tzinfo=None)
        key = (kind, fingerprint)
        if key in seen:
            if timestamp < seen[key]:
                connection.execute(claims.update().where(claims.c.kind == kind, claims.c.fingerprint == fingerprint)
                                   .values(capture_id=capture_id, sale_id=sale_id, created_at=timestamp))
                seen[key] = timestamp
            return
        seen[key] = timestamp
        connection.execute(claims.insert().values(id=str(uuid4()), created_at=timestamp,
                           kind=kind, fingerprint=fingerprint, capture_id=capture_id, sale_id=sale_id))

    # Key access is already required by the maintained backend migration runtime.
    # Never log decrypted evidence; unreadable legacy payloads still claim bytes.
    from app.security import cipher
    for row in connection.execute(sa.select(captures).order_by(captures.c.created_at, captures.c.id)).mappings():
        owner = {"capture_id": row["id"], "sale_id": capture_sale.get(row["id"]), "created_at": row["created_at"]}
        add("IMAGE", row["image_hash"], **owner)
        try:
            content = json.loads(cipher.decrypt(row["payload_encrypted"].encode())) if row["payload_encrypted"] else {}
            intake = content.get("intake") if isinstance(content, dict) else None
            intake = intake if isinstance(intake, dict) else {}
            for key, kind in (("order_reference", "REQUEST"), ("sr_number", "SR")):
                add(kind, ref_hash(intake.get(key)), **owner)
            for key in ("order_image", "payment_image"):
                value = intake.get(key)
                if value:
                    add("IMAGE", hashlib.sha256(base64.b64decode(value, validate=True)).hexdigest(), **owner)
            if not intake.get("order_reference"):
                add("REFERENCE", ref_hash(row["source_reference"]), **owner)
        except (ValueError, TypeError, KeyError, InvalidToken):
            add("REFERENCE", ref_hash(row["source_reference"]), **owner)
    for row in sale_rows:
        owner = {"capture_id": row["capture_id"], "sale_id": row["id"], "created_at": row["created_at"]}
        add("REQUEST", ref_hash(row["request_id"]), **owner)
        details = row["details"] if isinstance(row["details"], dict) else {}
        add("SR", ref_hash(details.get("sr_number")), **owner)


def downgrade():
    for table, indexes in INDEXES.items():
        for name, _ in indexes:
            op.drop_index(name, table_name=table)
    op.drop_table("capture_identity_claims")
