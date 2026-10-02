"""Business categories and explicit branch lifecycle; preserve historical stock."""
from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"


def upgrade():
    op.add_column("kyc_captures", sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id", name="fk_capture_branch_snapshot"), nullable=True))
    op.get_bind().exec_driver_sql("UPDATE kyc_captures SET branch_id = COALESCE((SELECT s.branch_id FROM sales_records s WHERE s.capture_id = kyc_captures.id), (SELECT o.branch_id FROM outlets o JOIN agents a ON a.outlet_id = o.id WHERE a.id = kyc_captures.agent_id))")
    op.add_column("sim_inventory", sa.Column("business_category", sa.String(30), nullable=False, server_default="Not recorded"))
    op.add_column("branches", sa.Column("lifecycle_status", sa.String(20), nullable=False, server_default="ACTIVE"))
    op.add_column("branches", sa.Column("relocation_branch_id", sa.String(36), sa.ForeignKey("branches.id", name="fk_branch_relocation_destination"), nullable=True))
    op.get_bind().exec_driver_sql("UPDATE stock_thresholds SET category = category || ':Not recorded' WHERE category IN ('SIM:PHYSICAL', 'SIM:ESIM')")


def downgrade():
    op.get_bind().exec_driver_sql("UPDATE stock_thresholds SET category = CASE category WHEN 'SIM:PHYSICAL:Not recorded' THEN 'SIM:PHYSICAL' ELSE 'SIM:ESIM' END WHERE category IN ('SIM:PHYSICAL:Not recorded', 'SIM:ESIM:Not recorded')")
    op.drop_column("kyc_captures", "branch_id")
    op.drop_column("branches", "relocation_branch_id")
    op.drop_column("branches", "lifecycle_status")
    op.drop_column("sim_inventory", "business_category")
