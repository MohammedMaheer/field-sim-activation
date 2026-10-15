"""Customer withdrawal closes unfinished intake without manufacturing a sale."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
from threading import Barrier
from uuid import uuid4

from fastapi import Depends, FastAPI, Header
from fastapi.testclient import TestClient
from PIL import Image
import pytest
from sqlalchemy import create_engine, delete, func, inspect, select, tuple_
from sqlalchemy.orm import Session

from app import captures, sales_management, sim_scanning
from app import sr_verification  # noqa: F401 - Register submission tables before create_all.
from app.db import (Agent, Audit, Base, Branch, CaptureDraft, CaptureTransactionOutcome,
                    KycCapture, Movement, NoSaleFeedback, Outlet, Permission, Plan,
                    Product, Role, SalesRecord, Sim, SimProgress, User, get_db)
from app.role_policy import ROLE_PERMISSIONS
from app.security import cipher, principal


@pytest.fixture
def context(tmp_path):
    url = os.getenv("WITHDRAWAL_TEST_DATABASE") or "sqlite:///" + str(tmp_path / "withdrawal.db")
    assert not os.getenv("WITHDRAWAL_TEST_DATABASE") or url.endswith("/demo86qa"), "Use the explicitly isolated QA database"
    engine = create_engine(url, connect_args={"check_same_thread": False} if url.startswith("sqlite:") else {})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        original = {table.name: set(db.execute(select(*table.primary_key.columns)).all())
                    for table in Base.metadata.sorted_tables}
        roles = {}
        for name, grants in ROLE_PERMISSIONS.items():
            role = db.scalar(select(Role).where(Role.name == name))
            if not role:
                role = Role(name=name)
                db.add(role)
                db.flush()
                db.add_all(Permission(role_id=role.id, name=grant) for grant in grants)
            roles[name] = role.id
        branches, agents, users = [], [], {}
        for index in range(2):
            branch = Branch(name=f"Withdrawal branch {index}")
            db.add(branch)
            db.flush()
            outlet = Outlet(branch_id=branch.id, name=branch.name, area="Synthetic", lat=0, lng=0)
            leader = User(name=f"Withdrawal leader {index}", email=f"leader-{uuid4()}@example.invalid",
                          role_id=roles["Team Leader"], password_hash="unused", branch_id=branch.id)
            user = User(name=f"Withdrawal agent {index}", email=f"agent-{uuid4()}@example.invalid",
                        role_id=roles["Field Agent"], password_hash="unused", branch_id=branch.id)
            db.add_all([outlet, leader, user])
            db.flush()
            agent = Agent(user_id=user.id, employee_id=str(uuid4()), outlet_id=outlet.id, leader_id=leader.id, lat=0, lng=0)
            db.add(agent)
            db.flush()
            branches.append(branch.id)
            agents.append(agent.id)
            users[f"agent{index}"] = user.id
            users[f"leader{index}"] = leader.id
        for role in ROLE_PERMISSIONS:
            user = User(name=role, email=f"role-{uuid4()}@example.invalid", role_id=roles[role], password_hash="unused")
            db.add(user)
            db.flush()
            users[role] = user.id
        product = Product(name="Withdrawal test product")
        db.add(product)
        db.flush()
        plan = Plan(product_id=product.id, name="Withdrawal test plan", monthly_cost=99, data_gb=10)
        db.add(plan)
        db.commit()
        plan_id = plan.id

    test_app = FastAPI()
    test_app.include_router(captures.router)
    test_app.include_router(sales_management.router)
    test_app.include_router(sim_scanning.router)

    def session():
        with Session(engine) as db:
            yield db

    def actor(x_test_user: str = Header(), db=Depends(get_db)):
        return db.get(User, x_test_user)

    test_app.dependency_overrides[get_db] = session
    test_app.dependency_overrides[principal] = actor
    with TestClient(test_app) as client:
        client.headers["X-Test-User"] = users["agent0"]
        yield client, engine, users, agents, branches, plan_id, test_app
    with Session(engine) as db:
        for table in reversed(Base.metadata.sorted_tables):
            keys = list(table.primary_key.columns)
            condition = (keys[0].not_in([row[0] for row in original[table.name]]) if len(keys) == 1
                         else tuple_(*keys).not_in(original[table.name]))
            db.execute(delete(table).where(condition))
        db.commit()
    engine.dispose()


def withdrawal(context, *, transaction=None, data=None, version=0, agent=None, note=""):
    client, _, _, agents, _, _, _ = context
    tx = transaction or str(uuid4())
    return {"agent_id": agent or agents[0], "transaction_id": tx, "version": version,
            "data": {"transaction_id": tx, "capture_mode": "SCREENSHOT_SALE", **(data or {})}, "note": note}


def post(context, body):
    return context[0].post("/api/kyc-captures/customer-backed-out", json=body)


@pytest.mark.parametrize("step", [0, 1, 2])
def test_partial_withdrawal_needs_no_document_or_geofence_and_records_no_sale(context, monkeypatch, step):
    client, engine, _, agents, _, _, _ = context
    monkeypatch.setattr(captures, "enforce_capture", lambda *_: pytest.fail("Ending intake must not require a work location"))
    body = withdrawal(context, data={"step": step, "name": "Customer left", "msisdn": "0500000123"})
    with Session(engine) as db:
        before = [db.scalar(select(func.count()).select_from(model)) for model in (SalesRecord, KycCapture, Movement)]
    response = post(context, body)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "CUSTOMER_BACKED_OUT" and not response.json()["already_recorded"]
    with Session(engine) as db:
        row = db.get(NoSaleFeedback, response.json()["feedback_id"])
        assert row.agent_id == agents[0] and row.customer_name == "Customer left"
        assert row.product_suggested == "Not recorded" and row.rejection_reason == "Customer backed out"
        assert cipher.decrypt(row.contact_encrypted.encode()).decode() == "0500000123"
        assert [db.scalar(select(func.count()).select_from(model)) for model in (SalesRecord, KycCapture, Movement)] == before
        assert db.scalar(select(Audit).where(Audit.entity == row.id)).action == "Customer Backed Out"
    own = client.get("/api/sales-management/feedback").json()
    assert any(row["id"] == response.json()["feedback_id"] for row in own)


def test_closes_matching_active_and_all_saved_copies_releases_only_pending_reservation(context):
    client, engine, users, agents, _, _, _ = context
    tx = str(uuid4())
    active = client.put("/api/kyc-captures/draft", json={"version": 0, "data": {"transaction_id": tx, "name": "Left"}}).json()
    saved = client.post("/api/kyc-captures/saved-drafts", json={"data": active["data"]}).json()
    # A second saved copy must not allow the closed customer interaction to reopen.
    client.post("/api/kyc-captures/saved-drafts", json={"data": active["data"]})
    other_saved = client.post("/api/kyc-captures/saved-drafts", json={"data": {"transaction_id": str(uuid4())}}).json()
    with Session(engine) as db:
        agent = db.get(Agent, agents[0])
        sim = Sim(iccid=str(uuid4()), serial=str(uuid4()), sim_type="Physical", status="AVAILABLE", agent_id=agent.id, outlet_id=agent.outlet_id)
        db.add(sim)
        db.flush()
        db.add(SimProgress(sim_id=sim.id, agent_id=agent.id, transaction_id=tx))
        db.commit()
        sim_id = sim.id
    body = withdrawal(context, transaction=tx, data={**active["data"], "saved_draft_id": saved["id"]}, version=active["version"])
    response = post(context, body)
    assert response.status_code == 200, response.text
    assert client.get("/api/kyc-captures/draft").json() == {"version": active["version"] + 1, "data": {}}
    assert [row["id"] for row in client.get("/api/kyc-captures/saved-drafts").json()] == [other_saved["id"]]
    with Session(engine) as db:
        assert db.get(Sim, sim_id).status == "AVAILABLE"
        assert not db.scalar(select(SimProgress).where(SimProgress.sim_id == sim_id))
    # Lost-response replay returns the same outcome, never a duplicate feedback.
    replay = post(context, body).json()
    assert replay["already_recorded"] and replay["feedback_id"] == response.json()["feedback_id"]
    assert client.put("/api/kyc-captures/draft", json={"version": replay["version"], "data": body["data"]}).status_code == 409
    assert client.post("/api/kyc-captures/saved-drafts", json={"data": body["data"]}).status_code == 409
    assert client.post("/api/inventory/scan", json={"code": "test-sim", "agent_id": agents[0], "transaction_id": tx}).status_code == 409


def test_stale_action_cannot_close_changed_active_draft_and_replay_never_clears_new_draft(context):
    client = context[0]
    tx = str(uuid4())
    first = client.put("/api/kyc-captures/draft", json={"version": 0, "data": {"transaction_id": tx}}).json()
    changed = client.put("/api/kyc-captures/draft", json={"version": first["version"], "data": {"transaction_id": tx, "name": "Updated"}}).json()
    body = withdrawal(context, transaction=tx, version=first["version"])
    assert post(context, body).status_code == 409
    assert client.get("/api/kyc-captures/draft").json() == changed
    body["version"] = changed["version"]
    closed = post(context, body).json()
    newer = client.put("/api/kyc-captures/draft", json={"version": closed["version"], "data": {"transaction_id": str(uuid4()), "name": "New customer"}}).json()
    assert post(context, body).json()["already_recorded"]
    assert client.get("/api/kyc-captures/draft").json() == newer


def test_unpersisted_withdrawal_preserves_another_draft_and_unknown_fields(context):
    client = context[0]
    other = client.put("/api/kyc-captures/draft", json={"version": 0, "data": {"transaction_id": str(uuid4()), "name": "Other"}}).json()
    response = post(context, withdrawal(context))
    assert response.status_code == 200
    assert client.get("/api/kyc-captures/draft").json() == other
    row = next(row for row in client.get("/api/sales-management/feedback").json() if row["id"] == response.json()["feedback_id"])
    assert row["customer_name"] == "" and row["contact"] == "Not recorded"


@pytest.mark.parametrize("role", ["Administrator", "Team Leader", "Branch Manager", "Sales Manager", "Compliance Officer", "Inventory Manager", "Tele Verification Officer", "Welcome Call Officer"])
def test_reporting_and_administrator_roles_cannot_end_captures(context, role):
    client, _, users, _, _, _, _ = context
    client.headers["X-Test-User"] = users[role]
    assert post(context, withdrawal(context)).status_code == 403


def test_operations_can_record_but_agent_cannot_close_other_agent_or_saved_draft(context):
    client, _, users, agents, _, _, _ = context
    tx = str(uuid4())
    client.headers["X-Test-User"] = users["agent1"]
    saved = client.post("/api/kyc-captures/saved-drafts", json={"data": {"transaction_id": tx}}).json()
    client.headers["X-Test-User"] = users["agent0"]
    assert post(context, withdrawal(context, transaction=tx, agent=agents[1])).status_code == 404
    assert post(context, withdrawal(context, transaction=tx, data={"saved_draft_id": saved["id"]})).status_code == 404
    assert post(context, withdrawal(context, transaction=tx)).status_code == 404
    assert client.put("/api/kyc-captures/draft", json={"version": 0, "data": {"transaction_id": tx}}).status_code == 404
    client.headers["X-Test-User"] = users["Operations Manager"]
    assert post(context, withdrawal(context, transaction=tx, agent=agents[1])).status_code == 404
    assert post(context, withdrawal(context, agent=agents[1])).status_code == 200


def sale(context, transaction):
    _, _, users, agents, _, plan, _ = context
    def image():
        stream = io.BytesIO()
        Image.new("RGB", (100, 80), tuple(uuid4().bytes[:3])).save(stream, format="PNG")
        return base64.b64encode(stream.getvalue()).decode()
    document, order = image(), image()
    fields = {"name": "Withdrawal sale", "document_number": "784199012345671", "nationality": "Synthetic", "birth_date": "1990-01-01", "expiry_date": "2090-12-31"}
    reference = "WD-" + str(uuid4())
    proof = cipher.encrypt(json.dumps({"image": hashlib.sha256(base64.b64decode(order)).hexdigest(),
        "fields": {"order_reference": reference, "msisdn": "0500000000"}, "user": users["agent0"], "expires": captures.now().timestamp() + 86400}).encode()).decode()
    return {"agent_id": agents[0], "operation_id": str(uuid4()), "intake": {**fields,
        "transaction_id": transaction, "capture_mode": "SCREENSHOT_SALE", "order_type": "NEW",
        "document_image": document, "document_check": captures.document_check(document, fields, users["agent0"]),
        "order_image": order, "order_check": proof, "order_reference": reference, "plan_id": plan, "msisdn": "0500000000"}}


def test_submitted_transaction_cannot_be_withdrawn_and_closed_transaction_cannot_submit(context):
    client, engine, users, _, _, _, _ = context
    tx = str(uuid4())
    payload = sale(context, tx)
    response = client.post("/api/kyc-captures/sale-submissions", json=payload)
    assert response.status_code == 201, response.text
    assert post(context, withdrawal(context, transaction=tx)).status_code == 409
    assert client.post("/api/kyc-captures/sale-submissions", json=payload).json()["id"] == response.json()["id"]
    other = str(uuid4())
    assert post(context, withdrawal(context, transaction=other)).status_code == 200
    assert client.post("/api/kyc-captures/sale-submissions", json=sale(context, other)).status_code == 409
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(CaptureTransactionOutcome).where(CaptureTransactionOutcome.creator_id == users["agent0"])) == 2


def test_concurrent_withdrawal_is_once_and_submit_vs_withdraw_has_one_terminal_outcome(context):
    client, engine, users, _, _, _, test_app = context
    if engine.dialect.name != "postgresql":
        pytest.skip("Row-lock race is verified against the isolated PostgreSQL QA database")
    tx = str(uuid4())
    body = withdrawal(context, transaction=tx)
    gate = Barrier(2)
    def run(path, payload):
        with TestClient(test_app) as other:
            gate.wait(timeout=10)
            return other.post(path, json=payload, headers={"X-Test-User": users["agent0"]})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: run("/api/kyc-captures/customer-backed-out", body), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert len({response.json()["feedback_id"] for response in responses}) == 1
    tx = str(uuid4())
    gate = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(run, "/api/kyc-captures/customer-backed-out", withdrawal(context, transaction=tx)),
                   pool.submit(run, "/api/kyc-captures/sale-submissions", sale(context, tx))]
        responses = [future.result(timeout=20) for future in pending]
    assert sorted(response.status_code for response in responses) in ([200, 409], [201, 409])
    with Session(engine) as db:
        outcome = db.scalar(select(CaptureTransactionOutcome).where(CaptureTransactionOutcome.transaction_id == tx))
        assert bool(outcome.feedback_id) != bool(outcome.capture_id)


def test_schema023_backfills_preserves_feedback_and_supports_upgrade_downgrade(context):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    _, engine, users, agents, branches, _, _ = context
    # This fixture owns the database connection: exercise the migration in a
    # separate schema-shaped disposable DB so API tests retain their table.
    migration_engine = create_engine("sqlite://")
    Base.metadata.create_all(migration_engine)
    tx = str(uuid4())
    active_tx = str(uuid4())
    with Session(engine) as source, Session(migration_engine) as target:
        for model in (Role, Branch, User, Outlet, Agent):
            rows = list(source.execute(select(model.__table__)).mappings())
            if rows:
                target.execute(model.__table__.insert(), [dict(row) for row in rows])
        identifiers = []
        for index in range(2):
            row = KycCapture(creator_id=users["agent0"], agent_id=agents[0], branch_id=branches[0],
                operation_id=str(uuid4()), source_reference=str(uuid4()), image_hash=str(index) * 64,
                image_type="image/png", image_encrypted="unused", status="SUBMITTED")
            captures.store(row, {"intake": {"transaction_id": tx}})
            target.add(row)
            target.flush()
            identifiers.append(row.id)
        feedback = NoSaleFeedback(agent_id=agents[0], branch_id=branches[0], customer_name="Earlier no sale",
            product_suggested="Plan", feedback="Preserve existing feedback", rejection_reason="No purchase")
        target.add(feedback)
        draft = CaptureDraft(creator_id=users["agent0"])
        captures.store(draft, {"transaction_id": active_tx})
        target.add(draft)
        target.commit()
        feedback_id = feedback.id
    CaptureTransactionOutcome.__table__.drop(migration_engine)
    path = Path(__file__).parents[1] / "migrations/versions/023_capture_transaction_outcomes.py"
    spec = importlib.util.spec_from_file_location("migration023", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with migration_engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        assert inspect(connection).has_table("capture_transaction_outcomes")
        rows = connection.execute(select(CaptureTransactionOutcome)).mappings().all()
        assert len(rows) == 2
        submitted = next(row for row in rows if row["transaction_id"] == tx)
        assert submitted["capture_id"] == identifiers[0] and submitted["status"] == "SUBMITTED"
        active = next(row for row in rows if row["transaction_id"] == active_tx)
        assert active["status"] == "ACTIVE" and active["creator_id"] == users["agent0"]
        migration.downgrade()
        assert not inspect(connection).has_table("capture_transaction_outcomes")
        assert connection.scalar(select(NoSaleFeedback.id).where(NoSaleFeedback.id == feedback_id)) == feedback_id
        assert connection.scalar(select(func.count()).select_from(KycCapture)) == 2
        migration.upgrade()
        assert inspect(connection).has_table("capture_transaction_outcomes")
    migration_engine.dispose()
