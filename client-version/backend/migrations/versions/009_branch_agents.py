"""Allow field agents to belong directly to a branch without a team leader."""

from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # SQLite recreates the table for a nullability change; dependent FKs
        # must be disabled for that copy and restored immediately afterwards.
        with op.get_context().autocommit_block():
            bind.exec_driver_sql("PRAGMA foreign_keys=OFF")
    try:
        with op.batch_alter_table("agents") as batch:
            batch.alter_column("leader_id", existing_type=sa.String(), nullable=True)
    finally:
        if bind.dialect.name == "sqlite":
            with op.get_context().autocommit_block():
                bind.exec_driver_sql("PRAGMA foreign_keys=ON")


def downgrade():
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM agents WHERE leader_id IS NULL LIMIT 1")).first():
        raise RuntimeError("Assign team leaders to direct-branch agents before downgrading")
    if bind.dialect.name == "sqlite":
        with op.get_context().autocommit_block():
            bind.exec_driver_sql("PRAGMA foreign_keys=OFF")
    try:
        with op.batch_alter_table("agents") as batch:
            batch.alter_column("leader_id", existing_type=sa.String(), nullable=False)
    finally:
        if bind.dialect.name == "sqlite":
            with op.get_context().autocommit_block():
                bind.exec_driver_sql("PRAGMA foreign_keys=ON")
