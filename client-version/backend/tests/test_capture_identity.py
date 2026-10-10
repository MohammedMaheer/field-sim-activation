"""Global duplicates, exact-operation retries, automatic SR and reassignment."""
import base64
import io
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import timedelta
from uuid import uuid4
from pathlib import Path
import importlib.util

import pytest
from PIL import Image
from sqlalchemy import delete, select, tuple_
from sqlalchemy.exc import IntegrityError

import test_client_scope as shared
from app import captures
from app.capture_identity import DUPLICATE_MESSAGE, identity_keys
from app.db import Agent, Base, CaptureIdentityClaim, DB, SalesRecord, User

client, database, login = shared.client, shared.database, shared.login


@pytest.fixture(autouse=True)
def new_records(database):
    with DB() as db:
        original = {table.name: set(db.execute(select(*table.primary_key.columns)).all())
                    for table in Base.metadata.sorted_tables}
    yield
    with DB() as db:
        for table in reversed(Base.metadata.sorted_tables):
            keys = list(table.primary_key.columns)
            condition = keys[0].not_in([row[0] for row in original[table.name]]) if len(keys) == 1 else tuple_(*keys).not_in(original[table.name])
            db.execute(delete(table).where(condition))
        db.commit()


def image():
    out = io.BytesIO()
    seed = uuid4().bytes
    Image.new("RGB", (100, 80), tuple(seed[:3])).save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode()


def sale_body(client, account="agent1", *, request_id=None, order_image=None, payment_image="", sr=""):
    profile = login(client, account)["user"]
    agent = client.get("/api/resources/agents").json()[0]
    plan = client.get("/api/resources/plans").json()[0]
    document = image()
    reference = request_id or "IDENTITY-" + str(uuid4())
    order = order_image or image()
    identity = {"name": "Same customer", "document_number": "784199012345671", "nationality": "Synthetic",
                "birth_date": "1990-01-01", "expiry_date": "2090-12-31"}
    document_proof = captures.document_check(document, identity, profile["id"])
    order_proof = captures.cipher.encrypt(json.dumps({"image": captures.hashlib.sha256(base64.b64decode(order)).hexdigest(),
        "fields": {"order_reference": reference, "msisdn": "0500000000"}, "user": profile["id"],
        "expires": captures.now().timestamp() + 86400}).encode()).decode()
    return {"agent_id": agent["id"], "operation_id": str(uuid4()), "intake": {
        **identity, "capture_mode": "SCREENSHOT_SALE", "order_type": "NEW", "document_image": document,
        "document_check": document_proof, "order_image": order, "order_check": order_proof,
        "order_reference": reference, "package_name": plan["name"], "plan_id": plan["id"],
        "msisdn": "0500000000", "payment_image": payment_image, "sr_number": sr}}


def submit(client, body):
    return client.post("/api/kyc-captures/sale-submissions", json=body)


def test_same_operation_retry_is_idempotent_and_changed_operation_conflicts(client):
    body = sale_body(client)
    first = submit(client, body)
    assert first.status_code == 201, first.text
    again = submit(client, body)
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    assert submit(client, {**body, "operation_id": str(uuid4())}).status_code == 409
    with DB() as db:
        assert len(db.scalars(select(SalesRecord).where(SalesRecord.capture_id == first.json()["id"])).all()) == 1


def test_committed_operation_retry_survives_archived_plan_and_expired_proof(client, monkeypatch):
    from app.db import Plan
    body = sale_body(client)
    first = submit(client, body)
    assert first.status_code == 201
    with DB() as db:
        plan = db.get(Plan, body["intake"]["plan_id"])
        active = plan.active
        plan.active = False
        db.commit()
    current = captures.now()
    monkeypatch.setattr(captures, "now", lambda: current + timedelta(days=61))
    try:
        replay = submit(client, body)
        assert replay.status_code == 201 and replay.json()["id"] == first.json()["id"]
        fresh = submit(client, {**body, "operation_id": str(uuid4())})
        assert fresh.status_code == 422
    finally:
        with DB() as db:
            db.get(Plan, body["intake"]["plan_id"]).active = active
            db.commit()


@pytest.mark.parametrize("duplicate", ["normalized_request", "same_order_image", "same_payment_image", "same_sr"])
def test_two_agents_cannot_record_same_reference_or_receipt(client, duplicate):
    receipt = image()
    first = sale_body(client, payment_image=receipt, sr="SR-991-" + uuid4().hex)
    created = submit(client, first)
    assert created.status_code == 201, created.text
    kwargs = {"request_id": first["intake"]["order_reference"].lower().replace("-", " ")} if duplicate == "normalized_request" else {
        "order_image": first["intake"]["order_image"]} if duplicate == "same_order_image" else {
        "payment_image": receipt} if duplicate == "same_payment_image" else {"sr": first["intake"]["sr_number"].lower().replace("-", " ")}
    other = sale_body(client, "agent2", **kwargs)
    response = submit(client, other)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == DUPLICATE_MESSAGE
    assert first["agent_id"] not in response.text and "Same customer" not in response.text


def test_same_customer_distinct_requests_are_allowed_and_cancelled_reference_stays_claimed(client):
    first = sale_body(client)
    result = submit(client, first)
    assert result.status_code == 201, result.text
    second = sale_body(client)
    assert submit(client, second).status_code == 201
    with DB() as db:
        row = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == result.json()["id"]))
        row.status = "CANCELLED"
        db.commit()
    retry = sale_body(client, "agent2", request_id=first["intake"]["order_reference"])
    assert submit(client, retry).status_code == 409


def test_manual_and_screenshot_sales_share_normalized_sr_claim(client):
    body = sale_body(client, sr="SR 8833-" + uuid4().hex)
    assert submit(client, body).status_code == 201
    login(client, "ops")
    response = client.post("/api/sales-management/sales", json={"agent_id": body["agent_id"], "order_type": "NEW",
        "customer_name": "Another customer", "plan_name": "Package", "request_id": str(uuid4()),
        "sr_number": body["intake"]["sr_number"].replace(" ", "-")})
    assert response.status_code == 409 and response.json()["detail"] == DUPLICATE_MESSAGE


def test_sr_and_request_identifiers_have_distinct_namespaces(client):
    identifier = "DOMAIN-" + uuid4().hex
    first = sale_body(client, request_id=identifier, sr="FIRST-SR-" + uuid4().hex)
    assert submit(client, first).status_code == 201
    other = sale_body(client, sr=identifier)
    assert submit(client, other).status_code == 201


def test_unique_constraint_is_final_race_guard(database):
    with DB() as db:
        # Two independently prepared writes cannot own the same key, even if
        # application reads both saw no existing claim.
        agent_row = db.scalar(select(Agent))
        from app.db import Outlet
        sale = SalesRecord(agent_id=agent_row.id, branch_id=db.get(Outlet, agent_row.outlet_id).branch_id,
                           outlet_id=agent_row.outlet_id, order_type="NEW", customer_name="Race", plan_name="Plan")
        db.add(sale)
        db.flush()
        key = identity_keys(references=["RACE-" + str(uuid4())])[0]
        db.add(CaptureIdentityClaim(kind=key[0], fingerprint=key[1], sale_id=sale.id))
        db.flush()
        db.add(CaptureIdentityClaim(kind=key[0], fingerprint=key[1], sale_id=sale.id))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()


def test_simultaneous_two_agent_receipt_submissions_record_only_once(client):
    receipt = image()
    first = sale_body(client, payment_image=receipt)
    first_token = client.headers["Authorization"]
    second = sale_body(client, "agent2", payment_image=receipt)
    second_token = client.headers["Authorization"]
    barrier = Barrier(2)

    def post(body, token):
        barrier.wait(timeout=5)
        return client.post("/api/kyc-captures/sale-submissions", json=body, headers={"Authorization": token})

    with ThreadPoolExecutor(max_workers=2) as executor:
        one = executor.submit(post, first, first_token)
        two = executor.submit(post, second, second_token)
        responses = [one.result(timeout=15), two.result(timeout=15)]
    assert sorted(result.status_code for result in responses) == [201, 409], [response.text for response in responses]
    assert next(response.json()["detail"] for response in responses if response.status_code == 409) == DUPLICATE_MESSAGE


@pytest.mark.parametrize("lines,expected", [
    ([{"text": "SR Number: 1234 5678"}], "12345678"),
    ([{"text": "Service Request No."}, {"text": "SR-188900"}], "SR-188900"),
    ([{"text": "Request ID: 1570837383"}, {"text": "Order created successfully"}], ""),
    ([{"text": "SR Number: 12345"}, {"text": "SR Number: 99999"}], ""),
])
def test_receipt_reads_only_explicit_unambiguous_sr(lines, expected):
    assert captures.receipt_sr_number(lines) == expected


def test_receipt_ocr_writer_access_and_proof_binds_sr_image_and_account(client, monkeypatch):
    receipt = image()
    monkeypatch.setattr(captures.extractor, "extract", lambda _: {"lines": [{"text": "SR Number: SR-9090123"}]})
    login(client)
    assert client.post("/api/kyc-captures/receipt-fields", json={"image_base64": receipt}).status_code == 403
    body = sale_body(client, payment_image=receipt)
    response = client.post("/api/kyc-captures/receipt-fields", json={"image_base64": receipt})
    assert response.status_code == 200
    result = response.json()
    assert result["fields"]["sr_number"] == "SR-9090123" and result["sr_check"]
    body["intake"].update(sr_number=result["fields"]["sr_number"], receipt_sr_check=result["sr_check"])
    changed = {**body, "intake": {**body["intake"], "sr_number": "SR-CHANGED"}}
    assert submit(client, changed).status_code == 422
    changed = {**body, "intake": {**body["intake"], "payment_image": image()}}
    assert submit(client, changed).status_code == 422
    other = sale_body(client, "agent2", payment_image=receipt)
    other["intake"].update(sr_number=result["fields"]["sr_number"], receipt_sr_check=result["sr_check"])
    assert submit(client, other).status_code == 422
    login(client, "agent1")
    assert submit(client, body).status_code == 201


def test_agent_keeps_sales_capture_and_notifications_after_branch_and_leader_transfer(client):
    body = sale_body(client)
    result = submit(client, body)
    assert result.status_code == 201, result.text
    capture_id = result.json()["id"]
    sale_id = client.get("/api/sales-management/sales").json()[0]["id"]
    with DB() as db:
        agent = db.get(Agent, body["agent_id"])
        user = db.get(User, agent.user_id)
        original = (agent.outlet_id, agent.leader_id, user.branch_id)
        sale = db.get(SalesRecord, sale_id)
        snapshot = (sale.branch_id, sale.leader_id)
        other = next(row for row in db.scalars(select(Agent)) if row.outlet_id != agent.outlet_id)
        agent.outlet_id, agent.leader_id = other.outlet_id, other.leader_id
        from app.db import Outlet
        user.branch_id = db.get(Outlet, other.outlet_id).branch_id
        db.commit()
    try:
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 200
        response = client.get(f"/api/sales-management/sales/{sale_id}")
        assert response.status_code == 200
        assert (response.json()["branch_id"], response.json()["leader_id"]) == snapshot
        assert sale_id in {row["id"] for row in client.get("/api/sales-management/sales").json()}
        branches = client.get("/api/resources/branches")
        assert branches.status_code == 200 and snapshot[0] in {row["id"] for row in branches.json()}
        scoped_agents = client.get("/api/resources/agents").json()
        assert {row["id"] for row in scoped_agents} == {body["agent_id"]}
    finally:
        with DB() as db:
            agent = db.get(Agent, body["agent_id"])
            agent.outlet_id, agent.leader_id, db.get(User, agent.user_id).branch_id = original
            db.commit()


@pytest.mark.parametrize("snapshot", ["linked_sale", "linked_null_capture_branch", "linked_conflicting_capture_branch", "legacy_capture_branch", "legacy_unknown_branch"])
def test_branch_manager_capture_scope_stays_with_saved_branch_after_agent_transfer(client, snapshot):
    from app.db import KycCapture, Outlet, Role
    from app.security import password_hash
    body = sale_body(client)
    created = submit(client, body)
    assert created.status_code == 201, created.text
    capture_id = created.json()["id"]
    with DB() as db:
        agent = db.get(Agent, body["agent_id"])
        agent_user = db.get(User, agent.user_id)
        original = (agent.outlet_id, agent.leader_id, agent_user.branch_id)
        original_branch = db.get(Outlet, agent.outlet_id).branch_id
        destination = next(row for row in db.scalars(select(Agent)) if db.get(Outlet, row.outlet_id).branch_id != original_branch)
        destination_branch = db.get(Outlet, destination.outlet_id).branch_id
        role_id = db.scalar(select(Role.id).where(Role.name == "Branch Manager"))
        manager_a = User(name="Original branch manager", email=f"manager-a-{uuid4()}@relay.demo", password_hash=password_hash("test-client-password"), role_id=role_id, branch_id=original_branch)
        manager_b = User(name="Destination branch manager", email=f"manager-b-{uuid4()}@relay.demo", password_hash=password_hash("test-client-password"), role_id=role_id, branch_id=destination_branch)
        db.add_all([manager_a, manager_b])
        if snapshot.startswith("legacy"):
            row = KycCapture(agent_id=agent.id, creator_id=agent.user_id, branch_id=original_branch if snapshot == "legacy_capture_branch" else None,
                             operation_id=str(uuid4()), source_reference="LEGACY-BRANCH-" + str(uuid4()), image_hash="b" * 64,
                             image_type="image/png", image_encrypted=captures.cipher.encrypt(base64.b64decode(body["intake"]["order_image"])).decode(), status="SUBMITTED")
            captures.store(row, {"rows": [], "history": [], "document_kind": "ACTIVATION_RECEIPT"})
            db.add(row)
            db.flush()
            capture_id = row.id
        elif snapshot == "linked_null_capture_branch":
            db.get(KycCapture, capture_id).branch_id = None
        elif snapshot == "linked_conflicting_capture_branch":
            db.get(KycCapture, capture_id).branch_id = destination_branch
        agent.outlet_id, agent.leader_id, agent_user.branch_id = destination.outlet_id, destination.leader_id, destination_branch
        db.commit()
        first_email, second_email = manager_a.email, manager_b.email
    try:
        login(client, first_email.split("@")[0])
        authorized = snapshot != "legacy_unknown_branch"
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == (200 if authorized else 404)
        assert client.get(f"/api/kyc-captures/{capture_id}/original").status_code == (200 if authorized else 404)
        assert any(row["id"] == capture_id for row in client.get("/api/kyc-captures?include_samples=true").json()) == authorized
        original_branch_rows = client.get(f"/api/kyc-captures?include_samples=true&branch_id={original_branch}").json()
        assert any(row["id"] == capture_id for row in original_branch_rows) == authorized
        login(client, second_email.split("@")[0])
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 404
        assert client.get(f"/api/kyc-captures/{capture_id}/original").status_code == 404
        assert all(row["id"] != capture_id for row in client.get("/api/kyc-captures?include_samples=true").json())
        assert all(row["id"] != capture_id for row in client.get(f"/api/kyc-captures?include_samples=true&branch_id={original_branch}").json())
        # The salesperson retains their own evidence, including legacy records
        # whose original branch could not be established safely for managers.
        login(client, "agent1")
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 200
        if authorized:
            assert any(row["id"] == capture_id for row in client.get(f"/api/kyc-captures?include_samples=true&branch_id={original_branch}").json())
    finally:
        with DB() as db:
            agent = db.get(Agent, body["agent_id"])
            agent.outlet_id, agent.leader_id, db.get(User, agent.user_id).branch_id = original
            db.commit()


@pytest.mark.parametrize("snapshot", ["linked_sale", "legacy_capture_branch", "legacy_unknown_branch"])
def test_team_leader_legacy_capture_cannot_follow_agent_into_foreign_branch(client, snapshot):
    from app.db import KycCapture, Outlet
    body = sale_body(client)
    created = submit(client, body)
    assert created.status_code == 201
    capture_id = created.json()["id"]
    with DB() as db:
        agent = db.get(Agent, body["agent_id"])
        original_agent = (agent.outlet_id, agent.leader_id, db.get(User, agent.user_id).branch_id)
        old_leader = db.get(User, agent.leader_id)
        old_leader_branch = old_leader.branch_id
        destination = next(row for row in db.scalars(select(Agent)) if db.get(Outlet, row.outlet_id).branch_id != old_leader.branch_id and row.leader_id)
        new_leader = db.get(User, destination.leader_id)
        old_email, new_email = old_leader.email, new_leader.email
        if snapshot.startswith("legacy"):
            row = KycCapture(agent_id=agent.id, creator_id=agent.user_id, branch_id=old_leader.branch_id if snapshot == "legacy_capture_branch" else None,
                             operation_id=str(uuid4()), source_reference="LEGACY-TL-" + str(uuid4()), image_hash="c" * 64,
                             image_type="image/png", image_encrypted=captures.cipher.encrypt(base64.b64decode(body["intake"]["order_image"])).decode(), status="SUBMITTED")
            captures.store(row, {"rows": [], "history": [], "document_kind": "ACTIVATION_RECEIPT"})
            db.add(row)
            db.flush()
            capture_id = row.id
        else:
            # Linked evidence retains its saved leader even when that leader is
            # subsequently assigned to a different branch.
            old_leader.branch_id = new_leader.branch_id
        agent.outlet_id, agent.leader_id, db.get(User, agent.user_id).branch_id = destination.outlet_id, new_leader.id, new_leader.branch_id
        db.commit()
    try:
        login(client, new_email.split("@")[0])
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 404
        assert client.get(f"/api/kyc-captures/{capture_id}/original").status_code == 404
        assert all(row["id"] != capture_id for row in client.get("/api/kyc-captures?include_samples=true").json())
        login(client, old_email.split("@")[0])
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == (200 if snapshot == "linked_sale" else 404)
        login(client)
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 200
        login(client, "agent1")
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 200
    finally:
        with DB() as db:
            agent = db.get(Agent, body["agent_id"])
            agent.outlet_id, agent.leader_id, db.get(User, agent.user_id).branch_id = original_agent
            db.get(User, original_agent[1]).branch_id = old_leader_branch
            db.commit()


def test_completed_capture_filter_includes_reviewed_screenshot_sale_and_excludes_cancelled(client):
    body = sale_body(client)
    response = submit(client, body)
    assert response.status_code == 201
    identifier = response.json()["id"]
    login(client)
    verified = client.post(f"/api/kyc-captures/{identifier}/review", json={"version": response.json()["version"], "outcome": "VERIFIED", "reason": "Independent evidence review completed"})
    assert verified.status_code == 200, verified.text
    assert verified.json()["activation_state"] == "ACTIVATED_PENDING_SR"
    completed = client.get("/api/kyc-captures?stage=COMPLETED&include_samples=true")
    assert completed.status_code == 200, completed.text
    assert any(row["id"] == identifier for row in completed.json())
    assert all(row["id"] != identifier for row in client.get("/api/kyc-captures?stage=READY&include_samples=true").json())
    with DB() as db:
        sale = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == identifier))
        sale.status = "CANCELLED"
        db.commit()
    assert all(row["id"] != identifier for row in client.get("/api/kyc-captures?stage=COMPLETED&include_samples=true").json())
    assert all(row["id"] != identifier for row in client.get("/api/kyc-captures?stage=READY&include_samples=true").json())


def test_schema018_backfills_duplicates_without_deleting_history_and_rolls_back():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect
    from sqlalchemy.orm import Session
    from app.db import Branch, Outlet, Role, KycCapture
    from app.capture_identity import reference_key

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        branch = Branch(name="Migration branch")
        role = Role(name="Field Agent")
        db.add_all([branch, role])
        db.flush()
        user = User(name="Migration agent", email="migration@example.invalid", password_hash="unused", role_id=role.id)
        outlet = Outlet(name="Migration branch", branch_id=branch.id, area="", lat=0, lng=0)
        db.add_all([user, outlet])
        db.flush()
        agent = Agent(user_id=user.id, outlet_id=outlet.id, employee_id="MIGRATION-1", target=1, lat=0, lng=0)
        db.add(agent)
        db.flush()
        image_hash = "a" * 64
        captures_created = []
        for reference in ("Request-12345", "request 12345"):
            capture = KycCapture(agent_id=agent.id, creator_id=user.id, branch_id=branch.id, operation_id=str(uuid4()),
                                 source_reference=reference, image_hash=image_hash, image_type="image/png", image_encrypted="unused",
                                 status="SUBMITTED")
            captures.store(capture, {"document_kind": "SALE_SCREENSHOTS", "intake": {"order_reference": reference, "sr_number": "SR-998811"}})
            db.add(capture)
            db.flush()
            sale = SalesRecord(capture_id=capture.id, agent_id=agent.id, branch_id=branch.id, outlet_id=outlet.id,
                               order_type="NEW", customer_name="Historical customer", plan_name="Plan", request_id=reference,
                               status="CANCELLED", details={"sr_number": "SR-998811"})
            db.add(sale)
            captures_created.append(capture.id)
        db.commit()
    CaptureIdentityClaim.__table__.drop(engine)
    path = Path(__file__).parents[1] / "migrations" / "versions" / "018_capture_identity_claims.py"
    spec = importlib.util.spec_from_file_location("migration018", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as connection:
        for table, indexes in migration.INDEXES.items():
            for name, _ in indexes:
                connection.exec_driver_sql(f"DROP INDEX {name}")
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        rows = connection.execute(select(CaptureIdentityClaim)).mappings().all()
        assert len(rows) == 3  # Exact image, normalized request and SR.
        assert next(row["capture_id"] for row in rows if row["fingerprint"] == reference_key("request 12345")) == captures_created[0]
        assert connection.scalar(select(captures.func.count()).select_from(KycCapture)) == 2
        assert connection.scalar(select(captures.func.count()).select_from(SalesRecord)) == 2
        migration.downgrade()
        assert not inspect(connection).has_table("capture_identity_claims")
        assert connection.scalar(select(captures.func.count()).select_from(KycCapture)) == 2
        assert connection.scalar(select(captures.func.count()).select_from(SalesRecord)) == 2
        migration.upgrade()
        assert connection.scalar(select(captures.func.count()).select_from(CaptureIdentityClaim)) == 3
    engine.dispose()
