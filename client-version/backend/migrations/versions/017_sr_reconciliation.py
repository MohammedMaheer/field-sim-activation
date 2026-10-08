"""Daily SR reconciliation and durable, account-specific email alerts."""
from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"


def base_columns():
    return [sa.Column("id", sa.String(36), primary_key=True), sa.Column("created_at", sa.DateTime(), nullable=False)]


def upgrade():
    op.create_table("sr_batches", *base_columns(),
                    sa.Column("business_date", sa.String(10), nullable=False),
                    sa.Column("fingerprint", sa.String(64), nullable=False, unique=True),
                    sa.Column("filename", sa.String(180), nullable=False),
                    sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
                    sa.Column("summary", sa.JSON(), nullable=False),
                    sa.Column("report_encrypted", sa.Text(), nullable=False))
    op.create_table("sr_checks", *base_columns(),
                    sa.Column("sale_id", sa.String(36), sa.ForeignKey("sales_records.id"), nullable=False, unique=True),
                    sa.Column("status", sa.String(32), nullable=False),
                    sa.Column("business_date", sa.String(10), nullable=False),
                    sa.Column("batch_id", sa.String(36), sa.ForeignKey("sr_batches.id"), nullable=False),
                    sa.Column("verified_at", sa.DateTime(), nullable=False),
                    sa.Column("reason", sa.String(300), nullable=False))
    op.create_table("sr_notices", *base_columns(),
                    sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
                    sa.Column("sale_id", sa.String(36), sa.ForeignKey("sales_records.id"), nullable=False),
                    sa.Column("batch_id", sa.String(36), sa.ForeignKey("sr_batches.id"), nullable=False),
                    sa.Column("status", sa.String(32), nullable=False),
                    sa.Column("reason", sa.String(300), nullable=False),
                    sa.UniqueConstraint("user_id", "sale_id", "batch_id", name="uq_sr_notice_recipient"))
    op.create_table("email_outbox", *base_columns(),
                    sa.Column("event_key", sa.String(180), nullable=False),
                    sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
                    sa.Column("sale_id", sa.String(36), sa.ForeignKey("sales_records.id"), nullable=False),
                    sa.Column("recipient_encrypted", sa.Text(), nullable=False),
                    sa.Column("subject", sa.String(180), nullable=False), sa.Column("body", sa.Text(), nullable=False),
                    sa.Column("status", sa.String(20), nullable=False), sa.Column("attempts", sa.Integer(), nullable=False),
                    sa.Column("next_attempt_at", sa.DateTime(), nullable=False), sa.Column("sent_at", sa.DateTime(), nullable=True),
                    sa.Column("last_error", sa.String(180), nullable=False),
                    sa.UniqueConstraint("event_key", "user_id", name="uq_email_event_recipient"))
    for table, columns in {"sr_batches": ["created_at", "business_date"], "sr_checks": ["created_at", "status", "business_date"],
                           "sr_notices": ["created_at", "user_id", "sale_id"], "email_outbox": ["created_at", "user_id", "sale_id", "status"]}.items():
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade():
    for table in ("email_outbox", "sr_notices", "sr_checks", "sr_batches"):
        op.drop_table(table)
