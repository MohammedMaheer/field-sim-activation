"""Rehearse 011 -> 012 -> 011 -> 012 against an isolated deployment database copy."""
import os
import sys
from sqlalchemy.engine import make_url

sys.path.insert(0, "/app")

name = os.environ["RELAY_QA_DATABASE"]
if not name.startswith("relay_operations_qa_") or not name.replace("_", "").isalnum():
    raise SystemExit("Unexpected migration-check database")
os.environ["DATABASE_URL"] = make_url(os.environ["DATABASE_URL"]).set(database=name).render_as_string(hide_password=False)

from alembic import command
from alembic.config import Config
from sqlalchemy import text, inspect
from app.db import engine

tables = ("users", "plans", "sales_records", "field_assets", "sim_inventory")


def counts():
    with engine.connect() as connection:
        return {table: connection.execute(text(f"SELECT count(*) FROM {table}")).scalar() for table in tables}


before = counts()
config = Config("alembic.ini")
command.upgrade(config, "head")
assert counts() == before
assert "employment_status" in {column["name"] for column in inspect(engine).get_columns("agents")}
command.downgrade(config, "011")
assert counts() == before
command.upgrade(config, "head")
assert counts() == before
with engine.connect() as connection:
    assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "012"
    assert connection.execute(text("SELECT count(*) FROM sales_call_tasks")).scalar() == before["sales_records"] * 2
engine.dispose()
print("PostgreSQL migration and rollback rehearsal passed; accounts, plans, sales and stock preserved")
