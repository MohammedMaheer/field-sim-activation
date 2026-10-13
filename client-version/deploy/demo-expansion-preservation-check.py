"""Apply the explicitly authorized examples and verify every pre-existing row.

Run with the client API stopped and the same environment as the release image.
Output contains only counts, opaque identities and hashes, never row contents.
"""
import hashlib
import json
import os
from sqlalchemy import select

assert os.environ.get('RELAY_DEMO_EXPANSION') == '1', 'Explicit expansion opt-in required'
from app.main import app  # noqa: F401 - register every current feature model
from app.db import Base, DB
from app.demo_expansion import expand_demo


def snapshot():
    with DB() as db:
        return {
            table.name: {
                str(row['id']): hashlib.sha256(json.dumps(
                    dict(row), sort_keys=True, default=str).encode()).hexdigest()
                for row in db.execute(select(table)).mappings()
            }
            for table in Base.metadata.sorted_tables if 'id' in table.c
        }


before = snapshot()
result = expand_demo()
after = snapshot()
for table, rows in before.items():
    for ident, digest in rows.items():
        assert after[table].get(ident) == digest, f'Existing {table} row changed'
again = expand_demo()
assert again['added_total'] == 0, 'Repeated expansion must be a no-op'
assert snapshot() == after, 'Repeated expansion changed a row'
print(json.dumps({**result, 'existing_rows_verified': sum(map(len, before.values())),
                  'idempotent_rerun': True}, sort_keys=True))
