"""Encrypted customer intake drafts."""
from alembic import op
import sqlalchemy as sa
revision = "006"
down_revision = "005"
def upgrade():
    if "capture_drafts" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table("capture_drafts", sa.Column("id",sa.String(36),primary_key=True), sa.Column("created_at",sa.DateTime(),nullable=False), sa.Column("creator_id",sa.String(36),sa.ForeignKey("users.id"),nullable=False,unique=True), sa.Column("payload_encrypted",sa.Text(),nullable=False),sa.Column("version",sa.Integer(),nullable=False))
def downgrade():
    op.drop_table("capture_drafts")
