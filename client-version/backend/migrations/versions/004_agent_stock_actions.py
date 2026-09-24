"""Let field agents return or report damage to their own assigned SIMs."""

from alembic import op
from sqlalchemy import select
from app.db import Role, Permission, uid

revision = "004"
down_revision = "003"


def upgrade():
    bind = op.get_bind()
    role_id = bind.execute(select(Role.id).where(Role.name == "Field Agent")).scalar_one_or_none()
    if role_id and not bind.execute(
        select(Permission.id).where(Permission.role_id == role_id, Permission.name == "inventory.self")
    ).scalar_one_or_none():
        bind.execute(Permission.__table__.insert().values(id=uid(), role_id=role_id, name="inventory.self"))


def downgrade():
    raise RuntimeError("Agent stock actions require an explicit access review")
