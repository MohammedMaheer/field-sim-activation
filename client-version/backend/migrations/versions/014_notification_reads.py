"""Account-specific inbox read state; existing business records remain unchanged."""
from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"


def upgrade():
    if "notification_reads" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table("notification_reads",
                        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
                        sa.Column("event_key", sa.String(180), primary_key=True),
                        sa.Column("read_at", sa.DateTime(), nullable=False))


def downgrade():
    op.drop_table("notification_reads")
