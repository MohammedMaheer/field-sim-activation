"""Branch filters and activation displays preserve independent authorization and review."""
# Shared fixtures are imported by injectable name.
# ruff: noqa: F811
import json
from uuid import uuid4

import pytest

from test_branch_leaders import new_records_only  # noqa: F401
from test_client_scope import client, database, login  # noqa: F401
from app.activation_status import activation_presentation
from app.db import Agent, Customer, DB, KycCapture, Outlet, Role, SalesRecord, User
from sqlalchemy import select
from app.security import cipher


@pytest.mark.parametrize("sale,sr,review,external,state", [
    ("IN_PROGRESS", "PENDING_SR_VERIFICATION", "SUBMITTED", True, "ACTIVATED_PENDING_SR"),
    ("CLOSED", "MISMATCH", "VERIFIED", True, "ACTIVATED_SR_MISMATCH"),
    ("IN_PROGRESS", "MATCHED", "SUBMITTED", True, "ACTIVATED_PENDING_REVIEW"),
    ("CLOSED", "MATCHED", "VERIFIED", True, "FULLY_ACTIVATED"),
    ("IN_PROGRESS", "MATCHED", "", False, "PENDING_BACKEND_REVIEW"),
    ("CANCELLED", "MATCHED", "VERIFIED", True, "CANCELLED"),
    ("IN_PROGRESS", "MISMATCH", "REJECTED", True, "ACTIVATED_REVIEW_ACTION_REQUIRED"),
])
def test_activation_stages_do_not_conflate_sr_review_and_external_activation(sale, sr, review, external, state):
    result = activation_presentation(sale, sr, review, external)
    assert result["activation_state"] == state
    assert result["backend_review_status"] == (review or "PENDING")


def test_product_target_summary_includes_all_categories_and_branch_scope(client, new_records_only):
    login(client)
    rows = client.get("/api/resources/agents").json()
    first = next(row for row in rows if row["employee_id"] == "RLY-1041")
    second = next(row for row in rows if row["branch_id"] != first["branch_id"])
    for agent, product, daily, monthly in [(first, "NEW", 3, 60), (first, "HW", 2, 40), (second, "NEW", 7, 140)]:
        saved = client.put("/api/sales-management/targets", json={"agent_id": agent["id"], "period": "2038-10", "order_type": product, "daily_target": daily, "monthly_target": monthly})
        assert saved.status_code == 200, saved.text
    result = client.get(f"/api/sales-management/performance?period=2038-10&branch_id={first['branch_id']}").json()
    assert result["daily_target"] == 5 and result["monthly_target"] == 100
    by_product = {row["order_type"]: row for row in result["daily_targets_by_product"]}
    assert len(by_product) == 7 and by_product["NEW"]["target"] == 3 and by_product["HW"]["target"] == 2
    assert by_product["ELIFE"]["target"] is None and not by_product["ELIFE"]["configured"]
    login(client, "agent1")
    assert client.get(f"/api/sales-management/targets?period=2038-10&branch_id={second['branch_id']}").json() == []


def test_customer_history_retains_captured_fields_and_sr_without_exposing_images(client, new_records_only):
    login(client, "agent1")
    owner = client.get("/api/auth/me").json()
    with DB() as db:
        agent = db.get(Agent, owner["agent_id"])
        outlet = db.get(Outlet, agent.outlet_id)
        customer = Customer(agent_id=agent.id, name="Branch view sample", mobile="0500001234", nationality="Sample nationality")
        db.add(customer)
        db.flush()
        data = {"document_kind": "SALE_SCREENSHOTS", "intake": {"capture_mode": "SCREENSHOT_SALE", "document_number": "SAMPLE-1234", "birth_date": "1990-01-01", "expiry_date": "2090-01-01", "issue_date": "2020-01-01", "gender": "Female", "document_image": "never-return-this-image", "order_image": "never-return-this-order", "alternate_number": "0500000001"}}
        capture = KycCapture(branch_id=outlet.branch_id, agent_id=agent.id, creator_id=owner["id"], operation_id=str(uuid4()), source_reference="CONNECTED-" + str(uuid4()), status="SUBMITTED", payload_encrypted=cipher.encrypt(json.dumps(data).encode()).decode(), image_encrypted="unused", image_type="image/png", image_hash="a" * 64)
        db.add(capture)
        db.flush()
        sale = SalesRecord(agent_id=agent.id, leader_id=agent.leader_id, branch_id=outlet.branch_id, outlet_id=outlet.id, capture_id=capture.id, order_type="NEW", customer_name=customer.name, nationality=customer.nationality, document_encrypted=cipher.encrypt(b"SAMPLE-1234").decode(), plan_name="Captured plan", request_id="CONNECTED-" + str(uuid4()), status="IN_PROGRESS", details={"customer_id": customer.id, "sr_number": "SR-CONNECTED", "msisdn": customer.mobile})
        db.add(sale)
        db.commit()
        identifier, capture_id, branch_id = customer.id, capture.id, outlet.branch_id
    result = client.get(f"/api/resources/customers?branch_id={branch_id}")
    assert result.status_code == 200, result.text
    item = next(row for row in result.json() if row["id"] == identifier)
    assert item["document"] == "•••• 1234" and item["sr_number"] == "SR-CONNECTED"
    assert item["details"]["issue_date"] == "2020-01-01" and item["details"]["date_of_birth"] == "1990-01-01"
    assert item["sales"][0]["activation_state"] == "ACTIVATED_PENDING_SR"
    assert "never-return" not in result.text
    assert client.get(f"/api/kyc-captures/{capture_id}").json()["activation_state"] == "ACTIVATED_PENDING_SR"
    login(client, "agent2")
    assert identifier not in {row["id"] for row in client.get(f"/api/resources/customers?branch_id={branch_id}").json()}
    assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 404
    with DB() as db:
        agent = db.get(Agent, owner["agent_id"])
        other = db.scalar(select(Agent).where(Agent.outlet_id != agent.outlet_id, Agent.leader_id != agent.leader_id))
        previous = agent.outlet_id, agent.leader_id
        agent.outlet_id, agent.leader_id = other.outlet_id, other.leader_id
        db.commit()
    try:
        login(client, "leader")
        historical = next(row for row in client.get(f"/api/resources/customers?branch_id={branch_id}").json() if row["id"] == identifier)
        assert historical["branch_id"] == branch_id and historical["sr_number"] == "SR-CONNECTED"
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 200
        login(client, "leader2")
        assert identifier not in {row["id"] for row in client.get("/api/resources/customers").json()}
        assert client.get(f"/api/kyc-captures/{capture_id}").status_code == 404
    finally:
        with DB() as db:
            agent = db.get(Agent, owner["agent_id"])
            agent.outlet_id, agent.leader_id = previous
            db.commit()


@pytest.mark.parametrize("path", ["/api/kyc-captures?include_samples=true", "/api/field-assets", "/api/field-assets/requests/list", "/api/field-assets/report/summary", "/api/support-tickets", "/api/incentives", "/api/sales-management/feedback", "/api/sales-management/targets"])
def test_branch_filter_cannot_expand_sales_agent_scope(client, path):
    login(client)
    all_agents = client.get("/api/resources/agents").json()
    first = next(row for row in all_agents if row["employee_id"] == "RLY-1041")
    foreign = next(row["branch_id"] for row in all_agents if row["branch_id"] != first["branch_id"])
    login(client, "agent1")
    separator = "&" if "?" in path else "?"
    response = client.get(path + separator + "branch_id=" + foreign)
    assert response.status_code == 200, response.text
    assert response.json() == []


def test_zero_member_team_leader_can_see_own_profile_and_branch(client, new_records_only):
    login(client)
    from app.db import Role, User
    from app.security import password_hash
    with DB() as db:
        branch_id = db.scalar(select(Outlet.branch_id))
        person = User(name="New branch leader", email="zero-leader-" + str(uuid4()) + "@relay.demo", password_hash=password_hash("test-client-password"), role_id=db.scalar(select(Role.id).where(Role.name == "Team Leader")), branch_id=branch_id)
        db.add(person)
        db.commit()
        name, identifier = person.email.split("@")[0], person.id
    login(client, name)
    rows = client.get("/api/resources/team-leaders").json()
    assert len(rows) == 1 and rows[0]["leader_id"] == identifier and rows[0]["agents"] == 0
    assert {row["id"] for row in client.get("/api/resources/branches").json()} == {branch_id}


@pytest.mark.parametrize("role_name", ["Tele Verification Officer", "Welcome Call Officer"])
@pytest.mark.parametrize("assigned", [False, True])
def test_call_role_branch_picker_is_minimal_scoped_and_does_not_grant_resource_access(client, new_records_only, role_name, assigned):
    from app.security import password_hash
    login(client)
    branch_rows = client.get("/api/resources/branches").json()
    allowed_branch, foreign_branch = branch_rows[0]["id"], branch_rows[1]["id"]
    identifier = "branch-call-" + str(uuid4())
    with DB() as db:
        account = User(name="Branch call staff", email=identifier + "@relay.demo",
            password_hash=password_hash("test-client-password"),
            role_id=db.scalar(select(Role.id).where(Role.name == role_name)),
            branch_id=allowed_branch if assigned else None)
        db.add(account)
        db.commit()
    login(client, identifier)
    assert "read" not in client.get("/api/auth/me").json()["permissions"]
    response = client.get("/api/resources/branches")
    assert response.status_code == 200, response.text
    rows = response.json()
    assert all(set(row) == {"id", "name"} for row in rows)
    assert {row["id"] for row in rows} == ({allowed_branch} if assigned else {row["id"] for row in branch_rows})
    scoped = client.get("/api/resources/branches?branch_id=" + allowed_branch).json()
    assert [row["id"] for row in scoped] == [allowed_branch]
    foreign = client.get("/api/resources/branches?branch_id=" + foreign_branch).json()
    assert foreign == ([] if assigned else [{"id": foreign_branch, "name": branch_rows[1]["name"]}])
    assert client.get("/api/resources/branches?branch_id=unknown-branch").json() == []
    for resource in ["agents", "customers", "plans", "inventory", "activations", "team-leaders", "outlets", "audit"]:
        assert client.get("/api/resources/" + resource).status_code == 403, resource
    assert client.get("/api/kyc-captures").status_code == 403


@pytest.mark.parametrize("account,grant", [("tele", "call.tele.read"), ("welcome", "call.welcome.read")])
def test_call_branch_picker_requires_its_own_role_read_grant(client, monkeypatch, account, grant):
    from app import security
    original = security.permissions
    monkeypatch.setattr(security, "permissions", lambda db, user: original(db, user) - {grant})
    login(client, account)
    assert client.get("/api/resources/branches").status_code == 403


@pytest.mark.parametrize("intake", ["Invalid historical intake", ["Invalid historical intake"], 7, None])
def test_malformed_historical_intake_does_not_crash_capture_or_sale_read_paths(client, new_records_only, intake):
    from app import captures
    login(client, "agent1")
    owner = client.get("/api/auth/me").json()
    with DB() as db:
        agent = db.get(Agent, owner["agent_id"])
        outlet = db.get(Outlet, agent.outlet_id)
        capture = KycCapture(agent_id=agent.id, creator_id=owner["id"], branch_id=outlet.branch_id,
            operation_id=str(uuid4()), source_reference="HISTORICAL-" + str(uuid4()),
            image_encrypted="unused", image_hash="a" * 64, image_type="image/png", status="SUBMITTED")
        captures.store(capture, {"document_kind": "SALE_SCREENSHOTS", "intake": intake, "rows": [], "history": []})
        db.add(capture)
        db.flush()
        sale = SalesRecord(agent_id=agent.id, leader_id=agent.leader_id, branch_id=outlet.branch_id,
            outlet_id=outlet.id, capture_id=capture.id, order_type="NEW", customer_name="Historical sample",
            plan_name="Captured plan", request_id="HISTORY-" + str(uuid4()), details={})
        db.add(sale)
        db.commit()
        capture_id, sale_id, original_encrypted = capture.id, sale.id, capture.payload_encrypted
    detail = client.get("/api/kyc-captures/" + capture_id)
    assert detail.status_code == 200, detail.text
    assert detail.json()["intake"] == {}
    customer_fields = next(section["fields"] for section in detail.json()["invoice"]["sections"] if section["title"] == "Customer")
    assert all(field["value"] == "Not recorded" for field in customer_fields)
    sale_detail = client.get("/api/sales-management/sales/" + sale_id)
    assert sale_detail.status_code == 200, sale_detail.text
    assert sale_detail.json()["activation_state"] == "PENDING_BACKEND_REVIEW"
    with DB() as db:
        assert db.get(KycCapture, capture_id).payload_encrypted == original_encrypted
