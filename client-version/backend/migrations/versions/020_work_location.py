"""Explicit work sessions and configurable member geofences.

Additive and disabled by default. Existing locations and operational records are
preserved. Downgrade removes only this feature's tables and permission names;
export new work-location history before downgrading if it is required.
"""
from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"

TABLES = ("work_location_policy", "work_geofences", "work_geofence_assignments",
          "work_location_sessions", "work_locations", "work_locations_latest")
READERS = {"Administrator", "Operations Manager", "Sales Manager", "Branch Manager", "Team Leader"}
MANAGERS = {"Administrator", "Operations Manager"}


def upgrade():
    from app.location_tracking import LocationPolicy, WorkFence, FenceAssignment, WorkSession, WorkLocation, LatestWorkLocation
    from app.role_policy import ROLE_PERMISSIONS
    from uuid import uuid4
    from datetime import datetime, timezone

    connection = op.get_bind()
    for model in (LocationPolicy, WorkFence, FenceAssignment, WorkSession, WorkLocation, LatestWorkLocation):
        model.__table__.create(connection, checkfirst=True)
    roles = connection.execute(sa.text("SELECT id,name FROM roles")).all()
    granted = set(connection.execute(sa.text("SELECT role_id,name FROM permissions")).all())
    stamp = datetime.now(timezone.utc).replace(tzinfo=None)
    for role_id, name in roles:
        if name not in ROLE_PERMISSIONS:
            continue
        names = {"location.self"}
        if name in READERS:
            names.add("location.read")
        if name in MANAGERS:
            names.add("location.manage")
        for grant in names:
            if (role_id, grant) not in granted:
                connection.execute(sa.text("INSERT INTO permissions(id,created_at,role_id,name) VALUES(:id,:at,:role,:name)"),
                                   {"id": str(uuid4()), "at": stamp, "role": role_id, "name": grant})
    if not connection.scalar(sa.text("SELECT id FROM work_location_policy WHERE id='policy'")):
        connection.execute(sa.text("INSERT INTO work_location_policy(id,created_at,enabled) VALUES('policy',:at,:enabled)"),
                           {"at": stamp, "enabled": False})


def downgrade():
    connection = op.get_bind()
    connection.execute(sa.text("DELETE FROM permissions WHERE name IN ('location.self','location.read','location.manage')"))
    for name in reversed(TABLES):
        if sa.inspect(connection).has_table(name):
            op.drop_table(name)
