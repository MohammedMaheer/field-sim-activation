"""Grant plan management to the administrator role."""

from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"


def upgrade():
    bind = op.get_bind()
    roles = sa.table("roles", sa.column("id", sa.String()), sa.column("name", sa.String()))
    permissions = sa.table(
        "permissions",
        sa.column("id", sa.String()),
        sa.column("role_id", sa.String()),
        sa.column("name", sa.String()),
        sa.column("created_at", sa.DateTime()),
    )
    role_id = bind.execute(sa.select(roles.c.id).where(roles.c.name == "Administrator")).scalar()
    if role_id and not bind.execute(
        sa.select(permissions.c.id).where(
            permissions.c.role_id == role_id, permissions.c.name == "settings.write"
        )
    ).first():
        from datetime import datetime, timezone
        from uuid import uuid4

        bind.execute(
            permissions.insert().values(
                id=str(uuid4()),
                role_id=role_id,
                name="settings.write",
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )
        )


def downgrade():
    bind = op.get_bind()
    roles = sa.table("roles", sa.column("id", sa.String()), sa.column("name", sa.String()))
    permissions = sa.table(
        "permissions", sa.column("role_id", sa.String()), sa.column("name", sa.String())
    )
    role_id = bind.execute(sa.select(roles.c.id).where(roles.c.name == "Administrator")).scalar()
    if role_id:
        bind.execute(
            permissions.delete().where(
                permissions.c.role_id == role_id, permissions.c.name == "settings.write"
            )
        )
