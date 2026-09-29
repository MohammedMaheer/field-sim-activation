"""Call work queues, stock thresholds and scoped operations roles."""

from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"

ROLES = {
    "Sales Manager": ("read", "report.read"),
    "Tele Verification Officer": ("call.tele.read", "call.tele.write"),
    "Welcome Call Officer": ("call.welcome.read", "call.welcome.write"),
}


def upgrade():
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())
    if "sales_call_tasks" not in tables:
        op.create_table("sales_call_tasks",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("sale_id", sa.String(36), sa.ForeignKey("sales_records.id"), nullable=False),
            sa.Column("stage", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("last_outcome", sa.String(30), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("sale_id", "stage", name="uq_sales_call_task_stage"))
        for column in ("sale_id", "stage", "status"):
            op.create_index(f"ix_sales_call_tasks_{column}", "sales_call_tasks", [column])
    if "stock_thresholds" not in tables:
        op.create_table("stock_thresholds",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=False),
            sa.Column("category", sa.String(40), nullable=False),
            sa.Column("minimum", sa.Integer(), nullable=False),
            sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.UniqueConstraint("branch_id", "category", name="uq_stock_threshold_branch_category"))
        op.create_index("ix_stock_thresholds_branch_id", "stock_thresholds", ["branch_id"])
        op.create_index("ix_stock_thresholds_category", "stock_thresholds", ["category"])
    columns = {column["name"] for column in sa.inspect(connection).get_columns("field_asset_requests")}
    if "urgency" not in columns:
        op.add_column("field_asset_requests", sa.Column("urgency", sa.String(12), nullable=False, server_default="NORMAL"))
    movement_columns = {column["name"] for column in sa.inspect(connection).get_columns("field_asset_movements")}
    if "quantity_delta" not in movement_columns:
        op.add_column("field_asset_movements", sa.Column("quantity_delta", sa.Integer(), nullable=False, server_default="0"))
    asset_columns = {column["name"] for column in sa.inspect(connection).get_columns("field_assets")}
    for name, length in (("warehouse", 100), ("batch", 100), ("size", 40), ("condition", 100)):
        if name not in asset_columns:
            op.add_column("field_assets", sa.Column(name, sa.String(length), nullable=False, server_default=""))
    if "employment_status" not in {column["name"] for column in sa.inspect(connection).get_columns("agents")}:
        op.add_column("agents", sa.Column("employment_status", sa.String(20), nullable=False, server_default="ACTIVE"))

    moment = datetime.now(timezone.utc).replace(tzinfo=None)
    role_table = sa.table("roles", sa.column("id", sa.String), sa.column("created_at", sa.DateTime), sa.column("name", sa.String))
    permission_table = sa.table("permissions", sa.column("id", sa.String), sa.column("created_at", sa.DateTime), sa.column("role_id", sa.String), sa.column("name", sa.String))
    for name, permissions in ROLES.items():
        role_id = connection.execute(sa.text("SELECT id FROM roles WHERE name=:name"), {"name": name}).scalar()
        if not role_id:
            role_id = str(uuid4())
            connection.execute(role_table.insert().values(id=role_id, created_at=moment, name=name))
        for permission in permissions:
            exists = connection.execute(sa.text("SELECT id FROM permissions WHERE role_id=:role AND name=:name"), {"role": role_id, "name": permission}).scalar()
            if not exists:
                connection.execute(permission_table.insert().values(id=str(uuid4()), created_at=moment, role_id=role_id, name=permission))

    existing = set(connection.execute(sa.text("SELECT sale_id, stage FROM sales_call_tasks")).all())
    tasks = sa.table("sales_call_tasks", *(sa.column(name) for name in ("id", "created_at", "sale_id", "stage", "status", "last_outcome", "updated_at")))
    sales = connection.execute(sa.text("SELECT id FROM sales_records")).scalars().all()
    for sale_id in sales:
        latest = {}
        for stage, outcome in connection.execute(sa.text("SELECT stage, outcome FROM sales_call_attempts WHERE sale_id=:sale ORDER BY created_at, id"), {"sale": sale_id}):
            latest[stage] = outcome
        tele_outcome = latest.get("TELE_VERIFICATION", "")
        welcome_outcome = latest.get("WELCOME_CALL", "")
        tele_status = "COMPLETED" if tele_outcome == "PASSED" else "FAILED" if tele_outcome == "FAILED" else "PENDING"
        welcome_status = "BLOCKED" if tele_status != "COMPLETED" else "COMPLETED" if welcome_outcome in {"PASSED", "REACHED"} else "FAILED" if welcome_outcome == "FAILED" else "PENDING"
        for stage, status, outcome in (("TELE_VERIFICATION", tele_status, tele_outcome), ("WELCOME_CALL", welcome_status, welcome_outcome)):
            if (sale_id, stage) not in existing:
                connection.execute(tasks.insert().values(id=str(uuid4()), created_at=moment, sale_id=sale_id, stage=stage, status=status, last_outcome=outcome, updated_at=moment))


def downgrade():
    op.drop_column("agents", "employment_status")
    for name in ("warehouse", "batch", "size", "condition"):
        op.drop_column("field_assets", name)
    op.drop_table("stock_thresholds")
    op.drop_table("sales_call_tasks")
    op.drop_column("field_asset_requests", "urgency")
    op.drop_column("field_asset_movements", "quantity_delta")
    # Roles and permissions remain because users may have been assigned to them.
