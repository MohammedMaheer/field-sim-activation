"""Start a fresh, isolated PostgreSQL QA instance using the release image."""
import os
import sys
from sqlalchemy.engine import make_url

sys.path.insert(0, "/app")
name = os.environ["RELAY_QA_DATABASE"]
if not name.startswith("relay_rigorous_qa_") or not name.replace("_", "").isalnum():
    raise SystemExit("Unexpected QA database")
os.environ["DATABASE_URL"] = make_url(os.environ["DATABASE_URL"]).set(database=name).render_as_string(hide_password=False)
os.environ["WEB_ORIGIN"] = "http://127.0.0.1:5191"
os.environ["COOKIE_SECURE"] = "false"
os.environ["DEMO_PASSWORD"] = "isolated-rigorous-qa-2026"
os.environ["RELAY_SEED_SALES"] = "YES"
os.environ["RELAY_SEED_OPERATIONS"] = "YES"
from alembic import command
from alembic.config import Config
command.upgrade(Config("alembic.ini"), "head")
from app.seed import seed
from app.sales_seed import seed as sales_seed
from app.operations_seed import seed as operations_seed
seed()
sales_seed()
operations_seed()
import uvicorn
uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
