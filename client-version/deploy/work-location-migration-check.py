"""Validate 019 -> 020 -> 019 on the named disposable PostgreSQL QA database."""
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone

from sqlalchemy import delete, inspect, select, text
from sqlalchemy.engine import make_url

url = make_url(os.environ['DATABASE_URL'])
assert url.database == 'geofence80qa' and url.host == 'qanawat-geo80-db', 'Disposable database required'
from app.db import Base, engine, DB, Role, User, Permission, now
# Build the existing 019 model schema, then test the release's actual upgrade.
# Historic 001 uses current model metadata and is not a clean-install replay.
Base.metadata.create_all(engine)
assert not any(table.startswith('work_') for table in inspect(engine).get_table_names())
subprocess.run(['alembic', 'stamp', '019'], check=True)
from app.seed import seed
seed()
with DB() as db:
    db.execute(delete(Permission).where(Permission.name.in_(['location.self', 'location.read', 'location.manage'])))
    db.commit()

TABLES = ('users', 'plans', 'sales_records', 'branches', 'agents', 'sim_inventory', 'kyc_captures', 'sales_targets', 'capture_drafts', 'support_tickets')
def fingerprint():
    with DB() as db:
        return {name: db.scalar(text(f"SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY t.id),'')) FROM {name} t")) for name in TABLES}
before = fingerprint()
subprocess.run(['alembic', 'upgrade', 'head'], check=True)
assert fingerprint() == before
from app.location_tracking import LocationPolicy, WorkSession, WorkLocation, WorkFence, begin_work, Point
with DB() as db:
    assert db.scalar(select(LocationPolicy.enabled)) is False
    assert db.scalar(select(WorkSession)) is None and db.scalar(select(WorkLocation)) is None
    for role in db.scalars(select(Role)):
        grants = set(db.scalars(select(Permission.name).where(Permission.role_id == role.id)))
        assert 'location.self' in grants
        assert ('location.manage' in grants) == (role.name in {'Administrator', 'Operations Manager'})
        assert ('location.read' in grants) == (role.name in {'Administrator', 'Operations Manager', 'Sales Manager', 'Branch Manager', 'Team Leader'})
    actor = db.scalar(select(User).where(User.email == 'tele@relay.demo'))
    user_id = actor.id
    db.add(WorkFence(name='Explicit migration QA fence', branch_id=actor.branch_id, latitude=25.08, longitude=55.141, radius_m=500))
    db.get(LocationPolicy, 'policy').enabled = True
    db.commit()

point = Point(latitude=25.08, longitude=55.141, accuracy_m=5, captured_at=now().replace(tzinfo=timezone.utc), device='Explicit PostgreSQL concurrency QA')
def concurrent_start(_):
    with DB() as db:
        session = begin_work(db, db.get(User, user_id), point)
        db.commit()
        return session.id
with ThreadPoolExecutor(max_workers=4) as pool:
    identifiers = list(pool.map(concurrent_start, range(4)))
assert len(set(identifiers)) == 1
with DB() as db:
    assert len(list(db.scalars(select(WorkSession)))) == 1
    assert len(list(db.scalars(select(WorkLocation)))) == 1
    assert '25.08' not in db.scalar(select(WorkLocation.coordinates_encrypted))
subprocess.run(['alembic', 'downgrade', '019'], check=True)
assert fingerprint() == before
with DB() as db:
    assert not any(table.startswith('work_') for table in inspect(db.bind).get_table_names())
    assert not db.scalar(select(Permission).where(Permission.name.like('location.%')))
subprocess.run(['alembic', 'upgrade', 'head'], check=True)
assert fingerprint() == before
print(json.dumps({'schema': '020', 'operational_records_preserved': True, 'default_enforcement': False, 'upgrade_downgrade_reupgrade': 'passed', 'concurrent_start_count': 4, 'active_sessions': 1, 'encrypted_gps': True}))
