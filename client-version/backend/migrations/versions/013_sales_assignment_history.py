"""Preserve Sales Manager and effective assignment without inventing past values."""
from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "manager_id" not in {column["name"] for column in inspector.get_columns("sales_records")}:
        with op.batch_alter_table("sales_records") as batch:
            batch.add_column(sa.Column("manager_id", sa.String(36), nullable=True))
            batch.create_foreign_key("fk_sale_manager", "users", ["manager_id"], ["id"])
            batch.create_index("ix_sales_records_manager_id", ["manager_id"])
    if "assignment_effective_at" not in {column["name"] for column in inspector.get_columns("agents")}:
        op.add_column("agents", sa.Column("assignment_effective_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("agents", "assignment_effective_at")
    inspector = sa.inspect(op.get_bind())
    constraint = next(item for item in inspector.get_foreign_keys("sales_records") if item["constrained_columns"] == ["manager_id"])
    with op.batch_alter_table("sales_records", naming_convention={"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}) as batch:
        batch.drop_index("ix_sales_records_manager_id")
        batch.drop_constraint(constraint["name"] or "fk_sales_records_manager_id_users", type_="foreignkey")
        batch.drop_column("manager_id")
