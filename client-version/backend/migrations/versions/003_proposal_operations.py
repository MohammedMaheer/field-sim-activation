"""Client proposal: field tasks, incentive records and scoped stock allocation."""

from alembic import op
from sqlalchemy import select
from app.db import FieldTask, Incentive, SupportTicket, Role, Permission, uid

revision = "003"
down_revision = "002"


def upgrade():
    bind = op.get_bind()
    FieldTask.__table__.create(bind, checkfirst=True)
    Incentive.__table__.create(bind, checkfirst=True)
    SupportTicket.__table__.create(bind, checkfirst=True)
    roles = {r.name: r.id for r in bind.execute(select(Role))}
    existing = {(p.role_id, p.name) for p in bind.execute(select(Permission))}
    additions = {
        "Administrator": ("task.write", "incentive.write", "inventory.write", "support.write"),
        "Operations Manager": ("task.write", "incentive.write", "inventory.write", "support.write"),
        "Cluster Manager": ("task.write", "support.write"),
        "Inventory Manager": ("inventory.write",),
        "Team Leader": ("task.write", "support.write"),
    }
    for role, names in additions.items():
        if role not in roles:
            continue  # Fresh installations seed roles after all migrations.
        for name in names:
            if (roles[role], name) not in existing:
                bind.execute(Permission.__table__.insert().values(id=uid(), role_id=roles[role], name=name))


def downgrade():
    raise RuntimeError("Proposal records require an explicit data retention procedure")
