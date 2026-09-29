"""Sales records, no-sale feedback, targets, and independent call history."""

from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"


def base():
    return [
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    ]


def upgrade():
    new_tables = {"sales_records", "no_sale_feedback", "sales_targets", "sales_call_attempts",
                  "field_assets", "field_asset_movements", "field_asset_requests"}
    existing = set(sa.inspect(op.get_bind()).get_table_names()) & new_tables
    if existing == new_tables:
        # A brand-new installation's initial migration builds the current ORM schema.
        return
    if existing:
        raise RuntimeError("Partial sales schema found; restore the database before retrying migration 011")
    op.create_table(
        "sales_records", *base(),
        sa.Column("capture_id", sa.String(36), sa.ForeignKey("kyc_captures.id"), unique=True),
        sa.Column("agent_id", sa.String(36), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("leader_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("outlet_id", sa.String(36), sa.ForeignKey("outlets.id"), nullable=False),
        sa.Column("order_type", sa.String(20), nullable=False),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("document_encrypted", sa.Text(), nullable=False),
        sa.Column("nationality", sa.String(80), nullable=False),
        sa.Column("plan_name", sa.String(160), nullable=False),
        sa.Column("request_id", sa.String(120), unique=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("status_updated_at", sa.DateTime(), nullable=False),
    )
    for column in ("agent_id", "leader_id", "branch_id", "order_type", "status"):
        op.create_index(f"ix_sales_records_{column}", "sales_records", [column])
    op.create_table(
        "no_sale_feedback", *base(),
        sa.Column("agent_id", sa.String(36), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("leader_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("contact_encrypted", sa.Text(), nullable=False),
        sa.Column("product_suggested", sa.String(160), nullable=False),
        sa.Column("feedback", sa.String(1000), nullable=False),
        sa.Column("rejection_reason", sa.String(300), nullable=False),
    )
    op.create_index("ix_no_sale_feedback_agent_id", "no_sale_feedback", ["agent_id"])
    op.create_index("ix_no_sale_feedback_branch_id", "no_sale_feedback", ["branch_id"])
    op.create_table(
        "sales_targets", *base(),
        sa.Column("agent_id", sa.String(36), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("order_type", sa.String(20), nullable=False),
        sa.Column("daily_target", sa.Integer(), nullable=False),
        sa.Column("monthly_target", sa.Integer(), nullable=False),
        sa.Column("set_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("agent_id", "period", "order_type", name="uq_sales_target_period"),
    )
    op.create_index("ix_sales_targets_agent_id", "sales_targets", ["agent_id"])
    op.create_index("ix_sales_targets_period", "sales_targets", ["period"])
    op.create_table(
        "sales_call_attempts", *base(),
        sa.Column("sale_id", sa.String(36), sa.ForeignKey("sales_records.id"), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("outcome", sa.String(30), nullable=False),
        sa.Column("remark", sa.String(1000), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_index("ix_sales_call_attempts_sale_id", "sales_call_attempts", ["sale_id"])
    op.create_table(
        "field_assets", *base(),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("serial", sa.String(120), unique=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("agent_id", sa.String(36), sa.ForeignKey("agents.id")),
        sa.Column("note", sa.String(500), nullable=False),
    )
    for column in ("category", "status", "branch_id", "agent_id"):
        op.create_index(f"ix_field_assets_{column}", "field_assets", [column])
    op.create_table(
        "field_asset_movements", *base(),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("field_assets.id"), nullable=False),
        sa.Column("from_branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("to_branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("from_agent_id", sa.String(36), sa.ForeignKey("agents.id")),
        sa.Column("to_agent_id", sa.String(36), sa.ForeignKey("agents.id")),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.String(300), nullable=False),
    )
    op.create_index("ix_field_asset_movements_asset_id", "field_asset_movements", ["asset_id"])
    op.create_table(
        "field_asset_requests", *base(),
        sa.Column("agent_id", sa.String(36), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(300), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("fulfilled_asset_id", sa.String(36), sa.ForeignKey("field_assets.id")),
    )
    for column in ("agent_id", "branch_id"):
        op.create_index(f"ix_field_asset_requests_{column}", "field_asset_requests", [column])


def downgrade():
    for table in ("field_asset_requests", "field_asset_movements", "field_assets", "sales_call_attempts", "sales_targets", "no_sale_feedback", "sales_records"):
        op.drop_table(table)
