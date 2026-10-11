"""Bounded encrypted stage OCR and recoverable processing leases.

Downgrade removes temporary stage jobs and legacy OCR lease metadata only.
Existing captured evidence, sales, accounts and review history are untouched.
Drain active OCR jobs before downgrading the API to schema 018.
"""
from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"


def upgrade():
    connection = op.get_bind()
    if not sa.inspect(connection).has_table("ocr_jobs"):
        op.create_table("ocr_jobs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("operation_id", sa.String(80), nullable=False),
            sa.Column("stage", sa.String(12), nullable=False),
            sa.Column("image_hash", sa.String(64), nullable=False),
            sa.Column("image_encrypted", sa.Text(), nullable=False),
            sa.Column("result_encrypted", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(12), nullable=False, server_default="QUEUED"),
            sa.Column("error", sa.String(200), nullable=False, server_default=""),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("lease_token", sa.String(36), nullable=True),
            sa.Column("lease_until", sa.DateTime(), nullable=True),
            sa.Column("available_at", sa.DateTime(), nullable=False),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("user_id", "operation_id", name="uq_ocr_job_owner_operation"))
    indexes = {row["name"] for row in sa.inspect(connection).get_indexes("ocr_jobs")}
    for name, columns in (
        ("ix_ocr_jobs_created_at", ["created_at"]),
        ("ix_ocr_jobs_user_id", ["user_id"]),
        ("ix_ocr_job_status_available", ["status", "available_at", "created_at"]),
        ("ix_ocr_job_owner_created", ["user_id", "created_at"]),
        ("ix_ocr_job_lease", ["status", "lease_until"]),
    ):
        if name not in indexes:
            op.create_index(name, "ocr_jobs", columns)
    columns = {row["name"] for row in sa.inspect(connection).get_columns("kyc_captures")}
    for column in (
        sa.Column("ocr_lease_token", sa.String(36), nullable=True),
        sa.Column("ocr_lease_until", sa.DateTime(), nullable=True),
        sa.Column("ocr_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ocr_available_at", sa.DateTime(), nullable=True),
    ):
        if column.name not in columns:
            op.add_column("kyc_captures", column)


def downgrade():
    with op.batch_alter_table("kyc_captures") as batch:
        for name in ("ocr_available_at", "ocr_attempts", "ocr_lease_until", "ocr_lease_token"):
            batch.drop_column(name)
    op.drop_table("ocr_jobs")
