"""Make branches explicit and withdraw location collection permission."""

from alembic import op
from sqlalchemy import inspect, text

revision = "005"
down_revision = "004"


def upgrade():
    bind = op.get_bind()
    tables = inspect(bind).get_table_names()
    if "clusters" in tables and "branches" not in tables:
        op.rename_table("clusters", "branches")
    for table in ("users", "outlets"):
        if "cluster_id" in {c["name"] for c in inspect(bind).get_columns(table)}:
            op.alter_column(table, "cluster_id", new_column_name="branch_id")
    bind.execute(text("UPDATE roles SET name='Branch Manager' WHERE name='Cluster Manager'"))
    # Legacy grants remain for reversible rollback; the client permission resolver
    # and route allowlist withdraw them from every current session.


def downgrade():
    bind = op.get_bind()
    for table in ("users", "outlets"):
        op.alter_column(table, "branch_id", new_column_name="cluster_id")
    op.rename_table("branches", "clusters")
    bind.execute(text("UPDATE roles SET name='Cluster Manager' WHERE name='Branch Manager'"))
