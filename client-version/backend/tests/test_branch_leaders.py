"""Multiple branch leaders retain explicit reporting lines and historical ownership."""
import base64
import io
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import delete, select, tuple_

import test_client_scope as shared
from app.db import Agent, Audit, Base, Branch, DB, KycCapture, Notification, Outlet, Role, SalesRecord, User

client, database, login = shared.client, shared.database, shared.login


@pytest.fixture(autouse=True)
def new_records_only(database):
    with DB() as db:
        original = {table.name: set(db.execute(select(*table.primary_key.columns)).all())
                    for table in Base.metadata.sorted_tables}
    yield
    with DB() as db:
        for table in reversed(Base.metadata.sorted_tables):
            keys = list(table.primary_key.columns)
            if len(keys) == 1:
                db.execute(delete(table).where(keys[0].not_in([row[0] for row in original[table.name]])))
            else:
                db.execute(delete(table).where(tuple_(*keys).not_in(original[table.name])))
        db.commit()


def branch(client):
    result = client.post("/api/organization/branches", json={"name": "Leader branch " + str(uuid4())[:8]})
    assert result.status_code == 201, result.text
    return result.json()["id"]


def leader(client, branch_id):
    identifier = "branch-leader-" + str(uuid4())[:8]
    result = client.post("/api/organization/teams", json={"name": "Branch Leader " + identifier[-8:],
        "email": identifier + "@relay.demo", "password": "test-client-password", "branch_id": branch_id})
    assert result.status_code == 201, result.text
    return result.json()["id"], identifier


def agent_body(branch_id, leader_id=""):
    identifier = "multi-agent-" + str(uuid4())[:8]
    return {"name": "Sales agent " + identifier[-8:], "branch_id": branch_id,
            "leader_id": leader_id, "email": identifier + "@relay.demo",
            "password": "test-client-password", "employee_id": identifier, "target": 12}


def test_second_leader_does_not_assign_or_reassign_branch_agents(client):
    login(client)
    branch_id = branch(client)
    # Legacy missing assignments may still exist, but cannot be provisioned anew.
    from app.security import password_hash
    with DB() as db:
        person = User(name="Legacy unassigned sales agent", email="legacy-" + str(uuid4()) + "@relay.demo",
            role_id=db.scalar(select(Role.id).where(Role.name == "Field Agent")), branch_id=branch_id,
            password_hash=password_hash("test-client-password"))
        db.add(person)
        db.flush()
        legacy = Agent(user_id=person.id, outlet_id=db.scalar(select(Outlet.id).where(Outlet.branch_id == branch_id)),
            employee_id="LEGACY-" + str(uuid4()), leader_id=None, lat=0, lng=0)
        db.add(legacy)
        db.commit()
        unassigned = legacy.id
    first, _ = leader(client, branch_id)
    assigned = client.post("/api/organization/agents", json=agent_body(branch_id, first)).json()["id"]
    with DB() as db:
        original_effective = db.get(Agent, assigned).assignment_effective_at
    second, _ = leader(client, branch_id)
    response = client.get(f"/api/organization/branches/{branch_id}/leaders")
    assert response.status_code == 200
    assert {row["id"] for row in response.json()["leaders"]} == {first, second}
    assert sorted(row["agents"] for row in response.json()["leaders"]) == [0, 1]
    with DB() as db:
        assert db.get(Agent, unassigned).leader_id is None
        assert db.get(Agent, assigned).leader_id == first
        assert db.get(Agent, assigned).assignment_effective_at == original_effective
    # Avoid choosing an arbitrary leader when a new sales agent is provisioned.
    ambiguous = agent_body(branch_id)
    denied = client.post("/api/organization/agents", json=ambiguous)
    assert denied.status_code == 422 and "team leader" in denied.text
    with DB() as db:
        assert db.scalar(select(User.id).where(User.email == ambiguous["email"])) is None


def test_plural_branch_leader_editor_is_atomic_stale_safe_and_audited(client):
    login(client)
    branch_id = branch(client)
    first, _ = leader(client, branch_id)
    second, _ = leader(client, branch_id)
    source = branch(client)
    available, _ = leader(client, source)
    empty = client.put(f"/api/organization/branches/{source}/leaders", json={
        "leader_ids": [], "expected_leader_ids": [available], "reason": "Prepare unassigned leader"})
    assert empty.status_code == 200, empty.text
    path = f"/api/organization/branches/{branch_id}/leaders"
    body = {"leader_ids": [first, available], "expected_leader_ids": [first, second],
            "reason": "Adjust branch leader roster"}
    duplicate = client.put(path, json={**body, "leader_ids": [first, first]})
    assert duplicate.status_code == 422
    invalid = client.put(path, json={**body, "leader_ids": [first, "not-a-leader"]})
    assert invalid.status_code == 422
    updated = client.put(path, json=body)
    assert updated.status_code == 200, updated.text
    assert set(updated.json()["leader_ids"]) == {first, available}
    assert client.put(path, json=body).status_code == 409
    with DB() as db:
        assert db.get(User, second).branch_id is None
        assert db.get(User, available).branch_id == branch_id
        event = db.scalar(select(Audit).where(Audit.entity == branch_id,
            Audit.action == "Branch team leaders updated"))
        assert set(event.old_value["leader_ids"]) == {first, second}
        assert set(event.new_value["leader_ids"]) == {first, available}
    profile = next(row for row in client.get("/api/administration/teams").json() if row["id"] == second)
    assert client.patch(f"/api/administration/teams/{second}", json={
        "values": {"name": "Available team leader", "branch_id": ""},
        "expected": {"name": profile["name"], "branch_id": None},
        "reason": "Update available team leader profile"}).status_code == 200
    unchanged = client.put(path, json={**body, "expected_leader_ids": [first, available]})
    assert unchanged.status_code == 200


def test_leader_with_sales_agents_cannot_be_removed_or_moved_silently(client):
    login(client)
    source, destination = branch(client), branch(client)
    person, _ = leader(client, source)
    leader(client, destination)
    agent_id = client.post("/api/organization/agents", json=agent_body(source, person)).json()["id"]
    removed = client.put(f"/api/organization/branches/{source}/leaders", json={
        "leader_ids": [], "expected_leader_ids": [person], "reason": "Changing leader reporting line"})
    assert removed.status_code == 409
    moved = client.patch(f"/api/administration/teams/{person}", json={
        "values": {"branch_id": destination}, "expected": {"branch_id": source},
        "reason": "Changing leader reporting branch"})
    assert moved.status_code == 409
    with DB() as db:
        assert db.get(User, person).branch_id == source
        assert db.get(Agent, agent_id).leader_id == person


def test_leader_account_edit_can_change_name_email_and_move_to_multi_leader_branch(client):
    login(client)
    source, destination = branch(client), branch(client)
    person, _ = leader(client, source)
    existing, _ = leader(client, destination)
    values = {"name": "Edited team leader", "email": "edited-" + str(uuid4())[:8] + "@relay.demo",
              "branch_id": destination}
    with DB() as db:
        row = db.get(User, person)
        before = {key: getattr(row, key) for key in values}
    response = client.patch(f"/api/administration/teams/{person}", json={
        "values": values, "expected": before, "reason": "Update team leader details and branch"})
    assert response.status_code == 200 and response.json()["branch_id"] == destination
    assert response.json()["name"] == values["name"] and response.json()["email"] == values["email"]
    assert {row["id"] for row in client.get(f"/api/organization/branches/{destination}/leaders").json()["leaders"]} == {person, existing}
    assert client.patch(f"/api/administration/teams/{person}", json={
        "values": values, "expected": before, "reason": "Stale team leader account edit"}).status_code == 409


def test_branch_creation_with_leaders_is_one_atomic_action(client):
    login(client)
    source = branch(client)
    first, _ = leader(client, source)
    second, _ = leader(client, source)
    assert client.put(f"/api/organization/branches/{source}/leaders", json={
        "leader_ids": [], "expected_leader_ids": [first, second], "reason": "Make leaders available"}).status_code == 200
    name = "Atomic leaders " + str(uuid4())[:8]
    denied = client.post("/api/organization/branches", json={"name": name, "leader_ids": [first, "missing"]})
    assert denied.status_code == 422
    with DB() as db:
        assert db.scalar(select(Branch.id).where(Branch.name == name)) is None
        assert db.get(User, first).branch_id is None
    result = client.post("/api/organization/branches", json={"name": name, "leader_ids": [first, second]})
    assert result.status_code == 201, result.text
    new_branch = result.json()["id"]
    assert {row["id"] for row in client.get(f"/api/organization/branches/{new_branch}/leaders").json()["leaders"]} == {first, second}


def test_transfer_to_multi_leader_branch_requires_explicit_reporting_line(client):
    login(client)
    source, destination = branch(client), branch(client)
    old, _ = leader(client, source)
    first, _ = leader(client, destination)
    second, _ = leader(client, destination)
    agent_id = client.post("/api/organization/agents", json=agent_body(source, old)).json()["id"]
    body = {"branch_id": destination, "stock_action": "RETURN", "reason": "Transfer sales agent to new branch"}
    path = f"/api/field-assets/agents/{agent_id}/transfer"
    response = client.post(path, json=body)
    assert response.status_code == 422 and "team leader" in response.text
    assert client.post(path, json={**body, "leader_id": old}).status_code == 422
    with DB() as db:
        assert db.get(Agent, agent_id).leader_id == old
    response = client.post(path, json={**body, "leader_id": second})
    assert response.status_code == 200, response.text
    with DB() as db:
        assert db.get(Agent, agent_id).leader_id == second
        assert db.get(User, db.get(Agent, agent_id).user_id).branch_id == destination
        assert db.get(User, first).branch_id == destination


@pytest.mark.parametrize("account", ["agent1", "leader", "salesmanager", "compliance", "inventory"])
def test_branch_leader_management_denies_unprivileged_roles(client, account):
    login(client)
    branch_id = branch(client)
    person, _ = leader(client, branch_id)
    login(client, account)
    assert client.get(f"/api/organization/branches/{branch_id}/leaders").status_code == 403
    assert client.put(f"/api/organization/branches/{branch_id}/leaders", json={
        "leader_ids": [], "expected_leader_ids": [person], "reason": "Forbidden reporting change"}).status_code == 403
    assert client.patch(f"/api/administration/teams/{person}", json={
        "values": {"name": "Forbidden edit"}, "expected": {"name": "Any"},
        "reason": "Forbidden leader account change"}).status_code == 403


def test_saved_sale_and_backend_alert_remain_with_original_reporting_leader(client):
    from app import captures
    from app.sales_management import register_capture_sale
    login(client)
    branch_id = branch(client)
    first, first_account = leader(client, branch_id)
    second, second_account = leader(client, branch_id)
    agent_id = client.post("/api/organization/agents", json=agent_body(branch_id, first)).json()["id"]
    plan_id = client.get("/api/resources/plans").json()[0]["id"]
    image = io.BytesIO()
    Image.new("RGB", (80, 80), "white").save(image, format="PNG")
    encoded = base64.b64encode(image.getvalue()).decode()
    with DB() as db:
        agent = db.get(Agent, agent_id)
        capture = KycCapture(agent_id=agent_id, creator_id=agent.user_id, operation_id=str(uuid4()),
            source_reference="LEADER-HISTORY-" + str(uuid4()), image_hash="test", image_type="image/png",
            image_encrypted=captures.cipher.encrypt(image.getvalue()).decode(), status="SUBMITTED", version=1)
        captures.store(capture, {"document_kind": "SALE_SCREENSHOTS", "intake": {
            "capture_mode": "SCREENSHOT_SALE", "document_type": "National ID", "name": "History customer",
            "document_number": "SAMPLE-123", "nationality": "Sample", "birth_date": "1990-01-01",
            "expiry_date": "2090-01-01", "document_image": encoded, "order_image": encoded,
            "plan_id": plan_id, "msisdn": "0500000000", "order_reference": "HISTORY-" + str(uuid4()),
            "order_type": "NEW"}, "rows": [], "history": []})
        db.add(capture)
        db.flush()
        register_capture_sale(db, capture)
        db.commit()
        capture_id = capture.id
        sale_id = db.scalar(select(SalesRecord.id).where(SalesRecord.capture_id == capture_id))
    management = client.get(f"/api/agents/{agent_id}/management").json()["agent"]
    changed = client.patch(f"/api/agents/{agent_id}/management", json={
        "target": management["target"], "outlet_id": management["outlet_id"], "leader_id": second,
        "expected_target": management["target"], "expected_outlet_id": management["outlet_id"],
        "expected_leader_id": first, "reason": "Change future sales reporting leader"})
    assert changed.status_code == 200, changed.text
    confirmed = client.post(f"/api/kyc-captures/{capture_id}/review", json={
        "version": 1, "outcome": "VERIFIED", "reason": "Independently checked original screenshots"})
    assert confirmed.status_code == 200, confirmed.text
    with DB() as db:
        assert db.get(Agent, agent_id).leader_id == second
        assert db.get(SalesRecord, sale_id).leader_id == first
        assert db.scalar(select(Notification.id).where(Notification.user_id == first,
            Notification.message.contains("LEADER-HISTORY-")))
        assert not db.scalar(select(Notification.id).where(Notification.user_id == second,
            Notification.message.contains("LEADER-HISTORY-")))
    login(client, first_account)
    assert client.get(f"/api/sales-management/sales/{sale_id}").status_code == 200
    assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 200
    assert client.get("/api/resources/agents").json() == []
    login(client, second_account)
    assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 404


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/kyc-captures/draft", None),
    ("PUT", "/api/kyc-captures/draft", {"version": 0, "data": {}}),
    ("GET", "/api/kyc-captures/saved-drafts", None),
    ("POST", "/api/kyc-captures/saved-drafts", {"data": {}}),
    ("POST", "/api/kyc-captures/read-document", {"image_base64": "image"}),
    ("POST", "/api/kyc-captures/read-order", {"image_base64": "image"}),
    ("POST", "/api/kyc-captures/sale-submissions", {"agent_id": "any", "operation_id": "test-operation-123456", "intake": {}}),
    ("POST", "/api/kyc-captures", {"agent_id": "any", "operation_id": "test-operation-123456", "image_base64": "image"}),
    ("POST", "/api/kyc-captures/unknown/submit", {"version": 1}),
    ("POST", "/api/kyc-captures/unknown/retry", {"version": 1}),
    ("POST", "/api/sales-management/sales", {"agent_id": "any", "order_type": "NEW", "customer_name": "Unauthorized", "plan_name": "Package"}),
    ("POST", "/api/sales-management/feedback", {"agent_id": "any", "product_suggested": "Package", "feedback": "Customer feedback", "rejection_reason": "No purchase"}),
])
def test_administrator_can_review_but_cannot_capture_transactions(client, method, path, body):
    login(client)
    assert "ekyc.write" not in client.get("/api/auth/me").json()["permissions"]
    response = client.request(method, path, json=body)
    assert response.status_code == 403, response.text
    assert client.get("/api/kyc-captures").status_code == 200
    # Both independent backend actions are allowed through their authorization gate.
    assert client.post("/api/kyc-captures/unknown/review", json={"version": 1,
        "outcome": "VERIFIED", "reason": "Review source evidence"}).status_code == 404
    assert client.post("/api/kyc-captures/unknown/activation", json={"version": 1,
        "outcome": "ACTIVATED", "reference": "ACT-123", "reason": "Record external activation"}).status_code == 404


@pytest.mark.parametrize("account", ["agent1", "ops"])
def test_sales_agent_and_operations_can_still_capture(client, account):
    login(client, account)
    assert "ekyc.write" in client.get("/api/auth/me").json()["permissions"]
    saved = client.post("/api/kyc-captures/saved-drafts", json={"data": {"name": "New customer"}})
    assert saved.status_code == 201, saved.text
    assert any(row["id"] == saved.json()["id"] for row in client.get("/api/kyc-captures/saved-drafts").json())


@pytest.mark.parametrize("leader_count", [0, 1, 2])
def test_new_agent_requires_selected_leader_even_when_branch_has_one(client, leader_count):
    login(client)
    branch_id = branch(client)
    people = [leader(client, branch_id)[0] for _ in range(leader_count)]
    body = agent_body(branch_id)
    missing = client.post("/api/organization/agents", json=body)
    assert missing.status_code == 422 and "designated team leader" in missing.text
    with DB() as db:
        assert db.scalar(select(User.id).where(User.email == body["email"])) is None
    if people:
        result = client.post("/api/organization/agents", json={**body, "leader_id": people[-1]})
        assert result.status_code == 201, result.text
        with DB() as db:
            assert db.get(Agent, result.json()["id"]).leader_id == people[-1]


@pytest.mark.parametrize("has_destination_leader", [False, True])
def test_transfer_requires_selected_leader_and_preserves_assignment_on_failure(client, has_destination_leader):
    login(client)
    source, destination = branch(client), branch(client)
    previous, _ = leader(client, source)
    assigned = client.post("/api/organization/agents", json=agent_body(source, previous)).json()["id"]
    destination_leader = leader(client, destination)[0] if has_destination_leader else None
    path = f"/api/field-assets/agents/{assigned}/transfer"
    body = {"branch_id": destination, "stock_action": "RETURN", "reason": "Choose destination reporting leader"}
    response = client.post(path, json=body)
    assert response.status_code == 422 and "team leader" in response.text
    with DB() as db:
        assert db.get(Agent, assigned).leader_id == previous
        assert db.get(Outlet, db.get(Agent, assigned).outlet_id).branch_id == source
    if destination_leader:
        assert client.post(path, json={**body, "leader_id": destination_leader}).status_code == 200


def test_management_cannot_remove_designated_leader_but_can_edit_legacy_target(client):
    login(client)
    branch_id = branch(client)
    designated, _ = leader(client, branch_id)
    identifier = client.post("/api/organization/agents", json=agent_body(branch_id, designated)).json()["id"]
    profile = client.get(f"/api/agents/{identifier}/management").json()["agent"]
    body = {"target": profile["target"] + 1, "outlet_id": profile["outlet_id"], "leader_id": None,
        "expected_target": profile["target"], "expected_outlet_id": profile["outlet_id"],
        "expected_leader_id": designated, "reason": "Change reporting assignment"}
    assert client.patch(f"/api/agents/{identifier}/management", json=body).status_code == 422
    with DB() as db:
        row = db.get(Agent, identifier)
        assert row.leader_id == designated and row.target == profile["target"]
        row.leader_id = None  # A pre-existing legacy assignment can be retained.
        db.commit()
    result = client.patch(f"/api/agents/{identifier}/management", json={**body, "expected_leader_id": None})
    assert result.status_code == 200, result.text
    with DB() as db:
        assert db.get(Agent, identifier).leader_id is None


@pytest.mark.parametrize("account", ["agent1", "ops"])
@pytest.mark.parametrize("invalid", ["missing", "other_branch", "wrong_role"])
def test_fresh_capture_and_direct_sale_require_actual_agent_valid_designated_leader(client, account, invalid):
    from app.db import Order
    from test_capture_identity import sale_body, submit
    owner = login(client, "agent1")["user"]["agent_id"]
    body = sale_body(client, account)
    body["agent_id"] = owner  # Operations captures on this sales agent's behalf.
    with DB() as db:
        row = db.get(Agent, owner)
        original = row.leader_id
        if invalid == "missing":
            row.leader_id = None
        elif invalid == "wrong_role":
            row.leader_id = db.scalar(select(User.id).where(User.email == "admin@relay.demo"))
        else:
            branch_id = db.get(Outlet, row.outlet_id).branch_id
            row.leader_id = db.scalar(select(User.id).join(Role).where(Role.name == "Team Leader", User.branch_id != branch_id))
        db.commit()
    try:
        responses = [
            submit(client, body),
            client.post("/api/kyc-captures", json={"agent_id": owner, "operation_id": body["operation_id"],
                "image_base64": body["intake"]["order_image"], "source_reference": "LEADER-" + str(uuid4())}),
            client.post("/api/transactions", json={"agent_id": owner, "operation_id": body["operation_id"]}),
            client.post("/api/sales-management/sales", json={"agent_id": owner, "order_type": "NEW",
                "customer_name": "Blocked sample", "plan_name": "Captured package", "request_id": body["intake"]["order_reference"]}),
        ]
        assert [response.status_code for response in responses] == [422] * 4, [response.text for response in responses]
        assert all("assign a valid branch team leader" in response.text for response in responses)
        with DB() as db:
            assert not db.scalar(select(KycCapture.id).where(KycCapture.operation_id == body["operation_id"]))
            assert not db.scalar(select(Order.id).where(Order.operation_id == body["operation_id"]))
            assert not db.scalar(select(SalesRecord.id).where(SalesRecord.request_id == body["intake"]["order_reference"]))
    finally:
        with DB() as db:
            db.get(Agent, owner).leader_id = original
            db.commit()


@pytest.mark.parametrize("account", ["agent1", "ops"])
def test_committed_capture_retry_and_read_keep_original_leader_if_current_assignment_missing(client, account):
    from test_capture_identity import image, sale_body, submit
    body = sale_body(client, account)
    first = submit(client, body)
    assert first.status_code == 201, first.text
    legacy_body = {"agent_id": body["agent_id"], "operation_id": str(uuid4()),
        "image_base64": image(), "source_reference": "LEADER-LEGACY-" + str(uuid4())}
    legacy = client.post("/api/kyc-captures", json=legacy_body)
    assert legacy.status_code == 201, legacy.text
    with DB() as db:
        row = db.get(Agent, body["agent_id"])
        original = row.leader_id
        sale = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == first.json()["id"]))
        assert sale.leader_id == original
        row.leader_id = None
        db.commit()
    try:
        retry = submit(client, body)
        assert retry.status_code == 201 and retry.json()["id"] == first.json()["id"]
        retry_legacy = client.post("/api/kyc-captures", json=legacy_body)
        assert retry_legacy.status_code == 201 and retry_legacy.json()["id"] == legacy.json()["id"]
        assert client.get("/api/kyc-captures/" + first.json()["id"]).status_code == 200
        with DB() as db:
            assert db.scalar(select(SalesRecord.leader_id).where(SalesRecord.capture_id == first.json()["id"])) == original
    finally:
        with DB() as db:
            db.get(Agent, body["agent_id"]).leader_id = original
            db.commit()


@pytest.mark.parametrize("account", ["agent1", "ops"])
def test_capture_grant_revocation_blocks_direct_sale_and_feedback_with_read_access_retained(client, account):
    from app.db import Permission
    profile = login(client, account)["user"]
    chosen = client.get("/api/resources/agents").json()[0]["id"]
    with DB() as db:
        grants = db.scalars(select(Permission).where(Permission.role_id == db.get(User, profile["id"]).role_id,
            Permission.name == "ekyc.write")).all()
        identifiers = [grant.id for grant in grants]
        for grant in grants:
            grant.name = "revoked.ekyc.write"
        db.commit()
    try:
        assert "read" in client.get("/api/auth/me").json()["permissions"]
        assert client.get("/api/sales-management/sales").status_code == 200
        assert client.post("/api/sales-management/sales", json={"agent_id": chosen,
            "order_type": "NEW", "customer_name": "Denied sample", "plan_name": "Package"}).status_code == 403
        assert client.post("/api/sales-management/feedback", json={"agent_id": chosen,
            "product_suggested": "Package", "feedback": "Customer declined", "rejection_reason": "No purchase"}).status_code == 403
    finally:
        with DB() as db:
            for identifier in identifiers:
                db.get(Permission, identifier).name = "ekyc.write"
            db.commit()
    assert client.post("/api/sales-management/sales", json={"agent_id": chosen, "order_type": "NEW",
        "customer_name": "Allowed sample", "plan_name": "Package", "request_id": "ROLE-" + str(uuid4())}).status_code == 201
    assert client.post("/api/sales-management/feedback", json={"agent_id": chosen,
        "product_suggested": "Package", "feedback": "Customer declined", "rejection_reason": "No purchase"}).status_code == 201


@pytest.mark.parametrize("snapshot", ["missing_branch", "foreign_branch", "leader_foreign"])
def test_unlinked_legacy_review_does_not_notify_an_inaccessible_current_leader(client, snapshot):
    from app import captures
    login(client)
    reference = "LEGACY-ALERT-" + str(uuid4())
    with DB() as db:
        agent = db.scalar(select(Agent).where(Agent.employee_id == "RLY-1041"))
        current_branch = db.get(Outlet, agent.outlet_id).branch_id
        original = agent.leader_id
        other = db.scalar(select(User).join(Role).where(Role.name == "Team Leader", User.branch_id != current_branch))
        branch_id = None if snapshot == "missing_branch" else other.branch_id if snapshot == "foreign_branch" else current_branch
        if snapshot == "leader_foreign":
            agent.leader_id = other.id
        row = KycCapture(branch_id=branch_id, agent_id=agent.id, creator_id=agent.user_id,
            operation_id=str(uuid4()), source_reference=reference, image_hash="test", image_type="image/png",
            image_encrypted=captures.cipher.encrypt(b"test").decode(), status="SUBMITTED", version=1)
        captures.store(row, {"rows": [], "history": []})
        db.add(row)
        db.commit()
        identifier, agent_id = row.id, agent.id
    try:
        response = client.post(f"/api/kyc-captures/{identifier}/review", json={"version": 1,
            "outcome": "VERIFIED", "reason": "Review historical branch evidence"})
        assert response.status_code == 200, response.text
        with DB() as db:
            assert not db.scalar(select(Notification.id).where(Notification.message.contains(reference)))
    finally:
        with DB() as db:
            db.get(Agent, agent_id).leader_id = original
            db.commit()


def test_linked_sale_review_notifies_saved_leader_after_cross_branch_transfer(client):
    from app import captures
    login(client)
    reference = "SAVED-LEADER-ALERT-" + str(uuid4())
    with DB() as db:
        agent = db.scalar(select(Agent).where(Agent.employee_id == "RLY-1041"))
        origin_branch = db.get(Outlet, agent.outlet_id).branch_id
        other = db.scalar(select(Agent).join(Outlet).where(Outlet.branch_id != origin_branch, Agent.leader_id.is_not(None)))
        original = agent.outlet_id, agent.leader_id
        row = KycCapture(branch_id=origin_branch, agent_id=agent.id, creator_id=agent.user_id,
            operation_id=str(uuid4()), source_reference=reference, image_hash="test", image_type="image/png",
            image_encrypted=captures.cipher.encrypt(b"test").decode(), status="SUBMITTED", version=1)
        captures.store(row, {"rows": [], "history": []})
        db.add(row)
        db.flush()
        db.add(SalesRecord(agent_id=agent.id, leader_id=original[1], branch_id=origin_branch,
            outlet_id=original[0], capture_id=row.id, order_type="NEW", customer_name="Historical sample",
            request_id=reference, details={}))
        agent.outlet_id, agent.leader_id = other.outlet_id, other.leader_id
        db.commit()
        identifier, agent_id = row.id, agent.id
    try:
        response = client.post(f"/api/kyc-captures/{identifier}/review", json={"version": 1,
            "outcome": "VERIFIED", "reason": "Review saved reporting evidence"})
        assert response.status_code == 200, response.text
        with DB() as db:
            recipients = set(db.scalars(select(Notification.user_id).where(Notification.message.contains(reference))))
            assert recipients == {original[1]}
    finally:
        with DB() as db:
            agent = db.get(Agent, agent_id)
            agent.outlet_id, agent.leader_id = original
            db.commit()
