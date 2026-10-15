"""Durable customer-withdrawal and submitted-intake outcomes.

Backfill submitted transaction identities without exposing captured images or
changing sales/stock. Downgrade removes only the closure index; feedback remains.
"""
import json
from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from cryptography.fernet import InvalidToken

revision = "023"
down_revision = "022"


def upgrade():
    connection = op.get_bind()
    if not sa.inspect(connection).has_table("capture_transaction_outcomes"):
        op.create_table(
            "capture_transaction_outcomes",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("creator_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("transaction_id", sa.String(80), nullable=False),
            sa.Column("agent_id", sa.String(36), sa.ForeignKey("agents.id"), nullable=True),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("feedback_id", sa.String(36), sa.ForeignKey("no_sale_feedback.id"), nullable=True),
            sa.Column("capture_id", sa.String(36), sa.ForeignKey("kyc_captures.id"), nullable=True),
            sa.UniqueConstraint("transaction_id", name="uq_capture_transaction_outcome"),
            sa.CheckConstraint("status IN ('ACTIVE', 'SUBMITTED', 'CUSTOMER_BACKED_OUT')", name="ck_capture_transaction_outcome_status"),
        )
    indexes = {row["name"] for row in sa.inspect(connection).get_indexes("capture_transaction_outcomes")}
    for column in ("created_at", "creator_id", "agent_id"):
        name = f"ix_capture_transaction_outcomes_{column}"
        if name not in indexes:
            op.create_index(name, "capture_transaction_outcomes", [column])

    metadata = sa.MetaData()
    outcomes = sa.Table("capture_transaction_outcomes", metadata, autoload_with=connection)
    captures = sa.Table("kyc_captures", metadata, autoload_with=connection)
    seen = set(connection.scalars(sa.select(outcomes.c.transaction_id)))
    # The migration runtime already supplies the encryption key (as in 018).
    from app.security import cipher
    for row in connection.execute(sa.select(captures).order_by(captures.c.created_at, captures.c.id)).mappings():
        try:
            content = json.loads(cipher.decrypt(row["payload_encrypted"].encode())) if row["payload_encrypted"] else {}
            intake = content.get("intake") if isinstance(content, dict) else None
            tx = intake.get("transaction_id", "") if isinstance(intake, dict) else ""
        except (InvalidToken, ValueError, TypeError, UnicodeError):
            continue
        if not isinstance(tx, str) or not tx.strip() or len(tx) > 80:
            continue
        key = tx
        if key in seen:
            continue
        seen.add(key)
        connection.execute(outcomes.insert().values(id=str(uuid4()), created_at=row["created_at"],
            creator_id=row["creator_id"], transaction_id=tx, agent_id=row["agent_id"],
            status="SUBMITTED", capture_id=row["id"]))
    # Existing unfinished drafts retain the same creator ownership. Submitted
    # captures above take precedence over stale copies of their old drafts.
    agents = sa.Table("agents", metadata, autoload_with=connection)
    own_agent = dict(connection.execute(sa.select(agents.c.user_id, agents.c.id)).tuples().all())
    for table_name in ("capture_drafts", "saved_capture_drafts"):
        drafts = sa.Table(table_name, metadata, autoload_with=connection)
        for row in connection.execute(sa.select(drafts).order_by(drafts.c.created_at, drafts.c.id)).mappings():
            try:
                content = json.loads(cipher.decrypt(row["payload_encrypted"].encode())) if row["payload_encrypted"] else {}
                tx = content.get("transaction_id", "") if isinstance(content, dict) else ""
            except (InvalidToken, ValueError, TypeError, UnicodeError):
                continue
            if not isinstance(tx, str) or not tx.strip() or len(tx) > 80 or tx in seen:
                continue
            seen.add(tx)
            connection.execute(outcomes.insert().values(id=str(uuid4()), created_at=row["created_at"],
                creator_id=row["creator_id"], transaction_id=tx, agent_id=own_agent.get(row["creator_id"]), status="ACTIVE"))


def downgrade():
    if sa.inspect(op.get_bind()).has_table("capture_transaction_outcomes"):
        op.drop_table("capture_transaction_outcomes")
