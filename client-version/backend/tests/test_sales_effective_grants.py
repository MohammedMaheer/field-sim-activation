"""Restricted management accounts must not retain mutation rights by role name."""
# Imported fixtures share the isolated SQLite setup and restore created records.
# ruff: noqa: F401, F811

import base64
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from test_client_scope import client, database, login
from test_sales_policy_october import agents, new_sale, policy_records
from app.db import DB, Permission, User, Branch, Outlet


@pytest.fixture
def restrict_grants(database):
    """Preserve grant primary keys so record-cleanup fixtures do not erase restores."""
    saved = {}

    def restrict(account, retained):
        with DB() as db:
            person = db.scalar(select(User).where(User.email == account + "@relay.demo"))
            saved.setdefault(person.role_id, [
                {"id": row.id, "role_id": row.role_id, "name": row.name, "created_at": row.created_at}
                for row in db.scalars(select(Permission).where(Permission.role_id == person.role_id))])
            db.execute(delete(Permission).where(Permission.role_id == person.role_id,
                                               Permission.name.not_in(retained)))
            db.commit()

    yield restrict
    with DB() as db:
        for role_id, rows in saved.items():
            db.execute(delete(Permission).where(Permission.role_id == role_id))
            db.add_all(Permission(**row) for row in rows)
        db.commit()


def encoded_file(text):
    return {"filename": "restricted.csv", "content_base64": base64.b64encode(text.encode()).decode()}


@pytest.mark.parametrize("account", ["admin", "ops"])
def test_read_only_management_cannot_correct_a_sale(client, restrict_grants, account):
    first, _ = agents(client)
    row = new_sale(client, first)
    login(client, account)
    restrict_grants(account, ["read"])
    response = client.patch("/api/sales-management/sales/" + row["id"], json={
        "order_type": "WASEL", "reason": "Read-only management cannot change product"})
    assert response.status_code == 403, response.text
    assert client.get("/api/sales-management/sales/" + row["id"]).json()["order_type"] == "NEW"


@pytest.mark.parametrize("account", ["admin", "ops"])
@pytest.mark.parametrize("apply", [False, True])
def test_read_only_management_cannot_preview_or_apply_sales_status_file(client, restrict_grants, account, apply):
    first, _ = agents(client)
    row = new_sale(client, first)
    login(client, account)
    restrict_grants(account, ["read"])
    body = {**encoded_file(f"sale_id,current_status,new_status\n{row['id']},IN_PROGRESS,CANCELLED\n"), "apply": apply}
    response = client.post("/api/sales-management/status-file", json=body)
    assert response.status_code == 403, response.text
    assert client.get("/api/sales-management/sales/" + row["id"]).json()["status"] == "IN_PROGRESS"


@pytest.mark.parametrize("account", ["admin", "ops", "leader"])
def test_read_only_management_cannot_set_or_import_targets(client, restrict_grants, account):
    login(client, account)
    first = client.get("/api/resources/agents").json()[0]
    restrict_grants(account, ["read"])
    response = client.put("/api/sales-management/targets", json={"agent_id": first["id"],
        "period": "2038-12", "order_type": "NEW", "daily_target": 2, "monthly_target": 20})
    assert response.status_code == 403, response.text
    body = encoded_file(f"employee_id,period,order_type,current_daily,current_monthly,daily_target,monthly_target\n{first['employee_id']},2038-12,NEW,,,2,20\n")
    for apply in (False, True):
        response = client.post("/api/sales-management/targets/file", json={**body, "apply": apply})
        assert response.status_code == 403, response.text
    assert client.get("/api/sales-management/targets?period=2038-12").json() == []


@pytest.mark.parametrize("account", ["admin", "ops"])
def test_read_only_management_cannot_create_or_reassign_staff(client, restrict_grants, account):
    login(client, account)
    staff = client.get("/api/sales-management/staff").json()[0]
    restrict_grants(account, ["read"])
    response = client.post("/api/sales-management/staff", json={"name": "Restricted test officer",
        "email": f"restricted-{uuid4()}@relay.demo", "password": "strong-test-password", "role": "Sales Manager"})
    assert response.status_code == 403, response.text
    response = client.patch("/api/sales-management/staff/" + staff["id"], json={
        "role": "Welcome Call Officer" if staff["role"] != "Welcome Call Officer" else "Tele Verification Officer",
        "reason": "Read-only management cannot change staff access"})
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("account", ["admin", "ops"])
def test_read_only_management_cannot_change_branch_or_agent_assignment(client, restrict_grants, account):
    login(client, account)
    branch = client.get("/api/resources/branches").json()[0]
    agent = client.get("/api/resources/agents").json()[0]
    management = client.get(f"/api/agents/{agent['id']}/management").json()["agent"]
    restrict_grants(account, ["read"])
    response = client.post("/api/organization/branches", json={"name": "Restricted branch " + str(uuid4())})
    assert response.status_code == 403, response.text
    response = client.patch(f"/api/administration/branches/{branch['id']}", json={
        "values": {"name": "Restricted branch rename"}, "expected": {"name": branch["name"]},
        "reason": "Read-only management cannot rename branches"})
    assert response.status_code == 403, response.text
    response = client.put(f"/api/organization/branches/{branch['id']}/leaders", json={
        "leader_ids": [], "expected_leader_ids": [], "reason": "Read-only management cannot assign leaders"})
    assert response.status_code == 403, response.text
    response = client.post(f"/api/branch-lifecycle/{branch['id']}", json={
        "action": "START_CLOSURE", "reason": "Read-only management cannot close branches"})
    assert response.status_code == 403, response.text
    response = client.patch(f"/api/agents/{agent['id']}/management", json={
        "target": management["target"] + 1, "outlet_id": management["outlet_id"], "leader_id": management["leader_id"],
        "expected_target": management["target"], "expected_outlet_id": management["outlet_id"],
        "expected_leader_id": management["leader_id"], "reason": "Read-only management cannot change assignment"})
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("account", ["admin", "ops", "inventory"])
def test_read_only_stock_management_cannot_add_or_adjust_stock(client, restrict_grants, account):
    login(client, account)
    branch = client.get("/api/resources/branches").json()[0]
    restrict_grants(account, ["read"])
    response = client.post("/api/field-assets", json={"category": "T_SHIRT", "label": "Restricted test stock",
        "quantity": 2, "branch_id": branch["id"]})
    assert response.status_code == 403, response.text
    response = client.put("/api/field-assets/report/threshold", json={
        "branch_id": branch["id"], "category": "T_SHIRT", "minimum": 20})
    assert response.status_code == 403, response.text
    response = client.post("/api/field-assets/missing/adjust", json={
        "delta": 2, "reason": "Read-only stock management cannot adjust stock"})
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("account", ["admin", "ops", "leader", "agent1"])
def test_read_only_accounts_cannot_request_stock(client, restrict_grants, account):
    login(client, account)
    agent = client.get("/api/resources/agents").json()[0]
    restrict_grants(account, ["read"])
    response = client.post("/api/field-assets/requests", json={
        "agent_id": agent["id"], "category": "T_SHIRT", "quantity": 2,
        "reason": "Read-only accounts cannot create stock requests", "urgency": "NORMAL"})
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("account", ["admin", "ops", "inventory"])
def test_stock_write_grant_does_not_require_organization_management(client, restrict_grants, account):
    login(client, account)
    branch = client.get("/api/resources/branches").json()[0]
    restrict_grants(account, ["read", "inventory.write"])
    response = client.post("/api/field-assets", json={"category": "T_SHIRT", "label": "Limited stock permission",
        "quantity": 2, "branch_id": branch["id"]})
    assert response.status_code == 201, response.text
    response = client.post(f"/api/field-assets/{response.json()['id']}/adjust", json={
        "delta": 1, "reason": "Audited adjustment with only the stock write grant"})
    assert response.status_code == 200 and response.json()["quantity"] == 3, response.text
    assert client.post("/api/organization/branches", json={"name": "Cannot manage organization " + str(uuid4())}).status_code == 403


@pytest.mark.parametrize("account", ["admin", "ops"])
def test_administration_inventory_uses_stock_grant_instead_of_organization_grant(client, restrict_grants, account):
    login(client, account)
    # Permission checks must use an active branch; a previously closed branch
    # correctly rejects stock regardless of the caller's grants.
    with DB() as db:
        outlet_id = db.scalar(select(Outlet.id).join(Branch, Outlet.branch_id == Branch.id).where(Branch.lifecycle_status == "ACTIVE"))
    assert outlet_id
    restrict_grants(account, ["read", "inventory.write"])
    identifier = "GRANT-" + str(uuid4())
    response = client.post("/api/administration/inventory", json={
        "values": {"iccid": identifier, "serial": identifier, "sim_type": "Physical", "outlet_id": outlet_id},
        "reason": "Add synthetic SIM using only stock management permissions"})
    assert response.status_code == 201, response.text
    assert response.json()["iccid"] == identifier


@pytest.mark.parametrize("account,grant", [("admin", "settings.write"), ("ops", "task.write")])
def test_staff_management_with_organization_grant_has_no_backend_verification_power(client, restrict_grants, account, grant):
    first, _ = agents(client)
    sale = new_sale(client, first)
    login(client, account)
    restrict_grants(account, ["read", grant])
    response = client.post("/api/sales-management/staff", json={"name": "Limited staff manager",
        "email": f"limited-{uuid4()}@relay.demo", "password": "strong-test-password", "role": "Sales Manager"})
    assert response.status_code == 201, response.text
    assert client.patch("/api/sales-management/sales/" + sale["id"], json={
        "order_type": "WASEL", "reason": "Organization grants cannot correct customer sales"}).status_code == 403


@pytest.mark.parametrize("account", ["admin", "ops", "leader"])
def test_target_write_without_read_access_is_denied(client, restrict_grants, account):
    login(client, account)
    agent = client.get("/api/resources/agents").json()[0]
    restrict_grants(account, ["task.write"])
    response = client.put("/api/sales-management/targets", json={"agent_id": agent["id"],
        "period": "2038-12", "order_type": "NEW", "daily_target": 2, "monthly_target": 20})
    assert response.status_code == 403, response.text
    body = encoded_file(f"employee_id,period,order_type,current_daily,current_monthly,daily_target,monthly_target\n{agent['employee_id']},2038-12,NEW,,,2,20\n")
    assert client.post("/api/sales-management/targets/file", json=body).status_code == 403


@pytest.mark.parametrize("account", ["admin", "ops"])
def test_backend_write_without_read_access_cannot_correct_or_cancel_sale(client, restrict_grants, account):
    first, _ = agents(client)
    sale = new_sale(client, first)
    login(client, account)
    restrict_grants(account, ["compliance.write"])
    assert client.patch("/api/sales-management/sales/" + sale["id"], json={
        "order_type": "WASEL", "reason": "Backend write without read cannot correct sales"}).status_code == 403
    body = {**encoded_file(f"sale_id,current_status,new_status\n{sale['id']},IN_PROGRESS,CANCELLED\n"), "apply": True}
    assert client.post("/api/sales-management/status-file", json=body).status_code == 403


@pytest.mark.parametrize("account,grants,stage", [
    ("tele", ["call.tele.write"], "TELE_VERIFICATION"),
    ("welcome", ["call.welcome.write"], "WELCOME_CALL"),
    ("admin", ["compliance.write"], "TELE_VERIFICATION"),
    ("ops", ["compliance.write"], "TELE_VERIFICATION"),
    ("compliance", ["compliance.write"], "TELE_VERIFICATION"),
])
def test_call_stage_write_without_its_read_access_is_denied(client, restrict_grants, account, grants, stage):
    first, _ = agents(client)
    sale = new_sale(client, first)
    login(client, account)
    restrict_grants(account, grants)
    response = client.post(f"/api/sales-management/sales/{sale['id']}/calls", json={
        "stage": stage, "outcome": "PASSED", "remark": "Call writer lacks required read access"})
    assert response.status_code == 403, response.text
