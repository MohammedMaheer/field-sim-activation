"""Rehearse 013 -> 014 -> 013 -> 014 on a restored client-only database."""
import os
import sys
from sqlalchemy.engine import make_url
sys.path.insert(0, "/app")
name = os.environ["RELAY_QA_DATABASE"]
if not name.startswith("relay_notifications_qa_") or not name.replace("_", "").isalnum():
    raise SystemExit("Unexpected rehearsal database")
os.environ["DATABASE_URL"] = make_url(os.environ["DATABASE_URL"]).set(database=name).render_as_string(hide_password=False)
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from app.db import engine
TABLES = ("users", "plans", "agents", "sales_records", "kyc_captures", "sim_inventory", "field_assets", "sales_call_tasks")
def counts():
    with engine.connect() as connection:
        return {table: connection.execute(text(f"SELECT count(*) FROM {table}")).scalar() for table in TABLES}
old = counts()
config = Config("alembic.ini")
command.upgrade(config, "014")
assert counts() == old
assert "notification_reads" in inspect(engine).get_table_names()
command.downgrade(config, "013")
assert counts() == old
command.upgrade(config, "014")
assert counts() == old
engine.dispose()
print("PostgreSQL upgrade, rollback and re-upgrade passed; existing business records unchanged")
