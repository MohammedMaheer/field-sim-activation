"""Confirmed October sales policy: rates, branch reporting, HW and call sequencing."""
import base64
import csv
import io
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, tuple_

import test_client_scope as shared
from app.db import Agent, Base, DB, SalesRecord, Sim, User
from app import sales_management as sales

client, database, login = shared.client, shared.database, shared.login


@pytest.fixture(autouse=True)
def policy_records(database):
    """Remove new synthetic rows without disturbing older modules' shared fixtures."""
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


def agents(client):
    login(client, "ops")
    rows = client.get("/api/resources/agents").json()
    return next(row for row in rows if row["employee_id"] == "RLY-1041"), next(row for row in rows if row["employee_id"] == "RLY-1044")


def new_sale(client, agent, order_type="NEW", **extra):
    login(client, "ops")
    response = client.post("/api/sales-management/sales", json={
        "agent_id": agent["id"], "order_type": order_type, "customer_name": "October policy customer",
        "plan_name": "Captured package", "request_id": "POLICY-" + str(uuid4()), **extra})
    assert response.status_code == 201, response.text
    return response.json()


def import_status(client, rows):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["sale_id", "current_status", "new_status"])
    writer.writerows(rows)
    return client.post("/api/sales-management/status-file", json={"filename": "statuses.csv",
        "content_base64": base64.b64encode(out.getvalue().encode()).decode(), "apply": True})


def test_sales_manager_reads_all_branches_and_cannot_mutate(client):
    first, other = agents(client)
    own, foreign = new_sale(client, first), new_sale(client, other)
    with DB() as db:
        outlet = db.get(Agent, other["id"]).outlet_id
        stock = Sim(iccid="POLICY-" + str(uuid4()), serial="POLICY-" + str(uuid4()),
                    sim_type="Physical", business_category="Postpaid", outlet_id=outlet,
                    agent_id=None, status="AVAILABLE")
        db.add(stock)
        db.commit()
        stock_id = stock.id
    login(client, "salesmanager")
    assert {own["id"], foreign["id"]} <= {row["id"] for row in client.get("/api/sales-management/sales").json()}
    assert client.get(f"/api/sales-management/sales/{foreign['id']}").status_code == 200
    assert {first["branch_id"], other["branch_id"]} <= {row["id"] for row in client.get("/api/resources/branches").json()}
    assert {first["id"], other["id"]} <= {row["id"] for row in client.get("/api/resources/agents").json()}
    assert stock_id in {row["id"] for row in client.get("/api/resources/inventory").json()}
    assert {first["branch_id"], other["branch_id"]} <= {row["branch_id"] for row in client.get("/api/resources/team-leaders").json()}
    assert client.get("/api/field-assets/report/summary").status_code == 200
    assert client.get("/api/sales-management/export?format=xlsx").status_code == 200
    assert client.get("/api/reports/branch").status_code == 200
    assert client.patch(f"/api/sales-management/sales/{foreign['id']}", json={"order_type": "NEW", "reason": "Forbidden correction"}).status_code == 403
    assert import_status(client, [[foreign["id"], "IN_PROGRESS", "CANCELLED"]]).status_code == 403
    assert client.post(f"/api/inventory/{stock_id}/move", json={"status": "DAMAGED", "reason": "Forbidden stock mutation"}).status_code == 403
    assert client.put("/api/sales-management/targets", json={"agent_id": other["id"], "period": "2035-10", "daily_target": 2, "monthly_target": 50}).status_code == 403
    login(client, "leader")
    assert client.get(f"/api/sales-management/sales/{foreign['id']}").status_code == 404


def test_sales_manager_creation_allows_global_account(client):
    login(client)
    response = client.post("/api/sales-management/staff", json={"name": "Global report manager",
        "email": "policy-" + str(uuid4()) + "@relay.demo", "password": "strong-test-password", "role": "Sales Manager"})
    assert response.status_code == 201, response.text
    rows = client.get("/api/sales-management/staff").json()
    assert next(row for row in rows if row["id"] == response.json()["id"])["branch"] == "All branches"


@pytest.mark.parametrize("mode,expected", [("DELIVERY", 201), ("WITHOUT_ROUTER", 201), ("ON_SPOT", 422)])
def test_hw_requires_serial_only_for_on_spot(client, mode, expected):
    first, _ = agents(client)
    result = client.post("/api/sales-management/sales", json={"agent_id": first["id"],
        "order_type": "HW", "router_fulfilment": mode, "customer_name": "HW policy customer", "plan_name": "Home package"})
    assert result.status_code == expected, result.text
    if expected == 201:
        row = result.json()
        assert row["router_fulfilment"] == mode and not row["router_serial"]
        assert import_status(client, [[row["id"], "IN_PROGRESS", "CLOSED"]]).status_code == 200


def test_hw_legacy_default_and_correction_preserve_validation(client):
    first, _ = agents(client)
    assert client.post("/api/sales-management/sales", json={"agent_id": first["id"], "order_type": "HW",
        "customer_name": "Legacy validation", "plan_name": "HW plan"}).status_code == 422
    row = new_sale(client, first)
    corrected = client.patch(f"/api/sales-management/sales/{row['id']}", json={"order_type": "HW",
        "router_fulfilment": "WITHOUT_ROUTER", "reason": "Customer chose service without router"})
    assert corrected.status_code == 200 and corrected.json()["router_fulfilment"] == "WITHOUT_ROUTER"
    assert client.patch(f"/api/sales-management/sales/{row['id']}", json={"order_type": "HW",
        "router_fulfilment": "ON_SPOT", "reason": "Serial absent from captured pack"}).status_code == 422
    assert client.patch(f"/api/sales-management/sales/{row['id']}", json={"order_type": "HW",
        "router_fulfilment": "UNKNOWN", "reason": "Unknown choice must fail"}).status_code == 422


@pytest.mark.parametrize("order_type", sales.ORDER_TYPES)
def test_call_queues_apply_only_to_approved_products(client, order_type):
    first, _ = agents(client)
    row = new_sale(client, first, order_type, **({"router_fulfilment": "DELIVERY"} if order_type == "HW" else {}))
    tasks = [task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == row["id"]]
    assert {task["stage"] for task in tasks} == ({"TELE_VERIFICATION", "WELCOME_CALL"} if order_type in sales.CALL_ORDER_TYPES else set())
    if order_type not in sales.CALL_ORDER_TYPES:
        login(client, "tele")
        assert client.post(f"/api/sales-management/sales/{row['id']}/calls", json={"stage": "TELE_VERIFICATION",
            "outcome": "PASSED", "remark": "Unexpected call"}).status_code == 409


def test_welcome_requires_tele_and_activation_in_either_recording_order(client):
    first, _ = agents(client)
    row = new_sale(client, first)
    login(client, "tele")
    assert client.post(f"/api/sales-management/sales/{row['id']}/calls", json={"stage": "TELE_VERIFICATION",
        "outcome": "PASSED", "remark": "Customer verified"}).status_code == 201
    login(client, "welcome")
    tasks = [task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == row["id"]]
    assert tasks[0]["status"] == "BLOCKED" and tasks[0]["activation_blocked"]
    assert client.post(f"/api/sales-management/sales/{row['id']}/calls", json={"stage": "WELCOME_CALL",
        "outcome": "REACHED", "remark": "Activation not recorded"}).status_code == 409
    login(client)
    assert import_status(client, [[row["id"], "IN_PROGRESS", "CLOSED"]]).status_code == 200
    login(client, "welcome")
    assert [task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == row["id"]][0]["status"] == "PENDING"
    assert client.post(f"/api/sales-management/sales/{row['id']}/calls", json={"stage": "WELCOME_CALL",
        "outcome": "REACHED", "remark": "Customer welcomed after activation"}).status_code == 201
    login(client)
    second = new_sale(client, first)
    assert import_status(client, [[second["id"], "IN_PROGRESS", "CLOSED"]]).status_code == 200
    assert [task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == second["id"]][0]["sequence_warning"]
    login(client, "welcome")
    assert client.post(f"/api/sales-management/sales/{second['id']}/calls", json={"stage": "WELCOME_CALL",
        "outcome": "REACHED", "remark": "Tele not completed"}).status_code == 409


def test_technical_postponement_next_day_limit_and_overdue(client, monkeypatch):
    first, _ = agents(client)
    row = new_sale(client, first)
    with DB() as db:
        db.get(SalesRecord, row["id"]).created_at = datetime(2035, 10, 7, 9)
        db.commit()
    monkeypatch.setattr(sales, "now", lambda: datetime(2035, 10, 7, 12))
    login(client, "tele")
    result = client.post(f"/api/sales-management/sales/{row['id']}/calls/defer-tele", json={"reason": "Technical device fault"})
    assert result.status_code == 200 and result.json()["due_date"] == "2035-10-08"
    assert client.post(f"/api/sales-management/sales/{row['id']}/calls/defer-tele", json={"reason": "Another postponement"}).status_code == 409
    task = next(task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == row["id"])
    assert task["deferred"] and not task["overdue"] and task["due_at"] == "2035-10-08T20:00:00+00:00"
    monkeypatch.setattr(sales, "now", lambda: datetime(2035, 10, 8, 20))
    assert next(task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == row["id"])["overdue"]
    login(client)
    assert client.post(f"/api/sales-management/sales/{row['id']}/calls/skip-tele", json={"reason": "Waiving is not allowed"}).status_code == 409
    second = new_sale(client, first)
    with DB() as db:
        db.get(SalesRecord, second["id"]).created_at = datetime(2035, 10, 7, 9)
        db.commit()
    assert client.post(f"/api/sales-management/sales/{second['id']}/calls/defer-tele", json={"reason": "Too late to extend"}).status_code == 409
    login(client, "agent1")
    assert client.post(f"/api/sales-management/sales/{second['id']}/calls/defer-tele", json={"reason": "Unauthorized postponement"}).status_code == 403


def test_cancellation_revises_original_day_rates_and_dashboard(client, monkeypatch):
    first, _ = agents(client)
    rows = [new_sale(client, first) for _ in range(15)]
    with DB() as db:
        for row in rows:
            db.get(SalesRecord, row["id"]).created_at = datetime(2035, 10, 7, 9)
        db.commit()
    assert import_status(client, [[row["id"], "IN_PROGRESS", "CLOSED"] for row in rows]).status_code == 200
    assert client.put("/api/sales-management/targets", json={"agent_id": first["id"], "period": "2035-10",
        "order_type": "ALL", "daily_target": 2, "monthly_target": 60}).status_code == 200
    monkeypatch.setattr(sales, "now", lambda: datetime(2035, 10, 8, 9))
    assert import_status(client, [[row["id"], "CLOSED", "CANCELLED"] for row in rows[:3]]).status_code == 200
    params = {"period": "2035-10", "agent_id": first["id"], "branch_id": first["branch_id"]}
    summary = client.get("/api/sales-management/performance", params=params).json()
    assert summary["closed"] == summary["mtd_achievement"] == 12
    assert summary["daily_summary"] == [{"date": "2035-10-07", "recorded": 15, "closed": 12, "cancelled": 3, "in_progress": 0}]
    assert summary["crr"] == 12 / 8 and summary["drr"] == (60 - 12) / 23
    assert summary["projection"] is None and summary["projection_status"] == "UNCONFIGURED"
    exported = client.get("/api/sales-management/export", params=params)
    assert sum(row["current_status"] == "CLOSED" for row in csv.DictReader(io.StringIO(exported.text))) == 12
    daily = client.get("/api/reports/daily", params={"start": "2035-10-07", "end": "2035-10-07", "status": "CLOSED"})
    assert len(list(csv.DictReader(io.StringIO(daily.text)))) == 12
    from app import main
    original_date = main.business_date
    monkeypatch.setattr(main, "business_date", lambda value=None: original_date(value) if value else datetime(2035, 10, 8).date())
    dashboard = client.get("/api/dashboard", params={"branch_id": first["branch_id"]}).json()
    assert next(day for day in dashboard["sales_trend"] if day["date"] == "2035-10-07")["activations"] == 12
    assert dashboard["sales_performance"]["closed"] == 12
    assert client.get("/api/sales-management/performance", params={**params, "branch_id": "foreign"}).json()["recorded"] == 0


@pytest.mark.parametrize("instant,period,elapsed,remaining", [
    (datetime(2035, 10, 31, 9), "2035-10", 31, 0),
    (datetime(2035, 11, 2, 9), "2035-10", 31, 0),
    (datetime(2035, 9, 30, 9), "2035-10", 0, 31),
    (datetime(2032, 2, 29, 9), "2032-02", 29, 0)])
def test_rate_calendar_boundaries(client, monkeypatch, instant, period, elapsed, remaining):
    login(client)
    monkeypatch.setattr(sales, "now", lambda: instant)
    response = client.get("/api/sales-management/performance", params={"period": period}).json()
    assert (response["elapsed_days"], response["remaining_days"]) == (elapsed, remaining)
    if not elapsed:
        assert response["crr"] is None
    if not remaining:
        assert response["drr"] is None


def test_drr_retains_negative_overachievement(client, monkeypatch):
    first, _ = agents(client)
    row = new_sale(client, first)
    with DB() as db:
        db.get(SalesRecord, row["id"]).created_at = datetime(2035, 10, 7)
        db.commit()
    assert import_status(client, [[row["id"], "IN_PROGRESS", "CLOSED"]]).status_code == 200
    assert client.put("/api/sales-management/targets", json={"agent_id": first["id"], "period": "2035-10",
        "order_type": "ALL", "daily_target": 0, "monthly_target": 0}).status_code == 200
    monkeypatch.setattr(sales, "now", lambda: datetime(2035, 10, 8))
    result = client.get("/api/sales-management/performance", params={"period": "2035-10", "agent_id": first["id"]}).json()
    assert result["drr"] == -1 / 23


@pytest.mark.parametrize("account", ["agent1", "leader", "salesmanager"])
def test_readonly_roles_cannot_reassign_branch_leader(client, account):
    first, _ = agents(client)
    with DB() as db:
        leader = db.scalar(select(User).where(User.email == "leader@relay.demo"))
        leader_id = leader.id
    login(client, account)
    assert client.put(f"/api/organization/branches/{first['branch_id']}/leader", json={"leader_id": leader_id}).status_code == 403
