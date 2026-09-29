"""Saved transactions and separately tracked SIM activation progress."""
from alembic import op
import sqlalchemy as sa
revision = "010"
down_revision = "009"

def upgrade():
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "saved_capture_drafts" not in tables:
        op.create_table("saved_capture_drafts", sa.Column("id",sa.String(36),primary_key=True), sa.Column("created_at",sa.DateTime(),nullable=False), sa.Column("creator_id",sa.String(36),sa.ForeignKey("users.id"),nullable=False), sa.Column("payload_encrypted",sa.Text(),nullable=False),sa.Column("version",sa.Integer(),nullable=False))
        op.create_index("ix_saved_capture_drafts_creator_id", "saved_capture_drafts", ["creator_id"])
    if "sim_progress" not in tables:
        op.create_table("sim_progress", sa.Column("id",sa.String(36),primary_key=True), sa.Column("created_at",sa.DateTime(),nullable=False),sa.Column("sim_id",sa.String(36),sa.ForeignKey("sim_inventory.id"),nullable=False,unique=True),sa.Column("agent_id",sa.String(36),sa.ForeignKey("agents.id"),nullable=False),sa.Column("transaction_id",sa.String(80),nullable=False),sa.Column("stage",sa.String(40),nullable=False),sa.Column("payment_status",sa.String(30),nullable=False),sa.Column("capture_id",sa.String(36),sa.ForeignKey("kyc_captures.id"),nullable=True))
        op.create_index("ix_sim_progress_agent_id", "sim_progress", ["agent_id"])
        op.create_index("ix_sim_progress_transaction_id", "sim_progress", ["transaction_id"])

def downgrade():
    op.drop_table("sim_progress")
    op.drop_table("saved_capture_drafts")
