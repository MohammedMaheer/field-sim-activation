import os
import base64
import io
import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from openpyxl import Workbook

temp = tempfile.TemporaryDirectory(prefix="relay-client-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(temp.name) / "client.db")
os.environ["DEMO_PASSWORD"] = "test-client-password"
from app.db import Base, engine, DB, Order, Audit, Agent
from app.main import app, limits
from app.seed import seed


def test_target_file_preview_apply_stale_and_scoped_access(client):
    import csv
    from app.sales_management import TARGET_COLUMNS
    login(client)
    agents = client.get('/api/resources/agents').json()
    agent = next(row for row in agents if row['employee_id'] == 'RLY-1041')
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(TARGET_COLUMNS)
    writer.writerow([agent['employee_id'], '2031-02', 'ALL', '', '', 3, 50])
    body = {'filename':'targets.csv','content_base64':base64.b64encode(out.getvalue().encode()).decode()}
    preview = client.post('/api/sales-management/targets/file', json=body)
    assert preview.status_code == 200 and not preview.json()['errors']
    assert not client.get('/api/sales-management/targets?period=2031-02').json()
    assert client.post('/api/sales-management/targets/file', json={**body,'apply':True}).json()['applied']
    assert client.post('/api/sales-management/targets/file', json={**body,'apply':True}).status_code == 422
    exported = client.get('/api/sales-management/targets/template?period=2031-02')
    from openpyxl import load_workbook
    book = load_workbook(io.BytesIO(exported.content))
    assert list(next(book.active.values)) == list(TARGET_COLUMNS)
    login(client, 'agent1')
    assert client.post('/api/sales-management/targets/file', json=body).status_code == 403
    assert next(row for row in client.get('/api/sales-management/targets?period=2031-02').json() if row['agent_id'] == agent['id'])['monthly_target'] == 50
    login(client, 'leader2')
    response = client.post('/api/sales-management/targets/file', json=body)
    if not any(row['id'] == agent['id'] for row in client.get('/api/resources/agents').json()):
        assert response.json()['errors']


def test_target_file_rejects_bad_rows_atomically(client):
    from app.sales_management import TARGET_COLUMNS
    login(client)
    agent = client.get('/api/resources/agents').json()[0]
    text = ','.join(TARGET_COLUMNS) + '\n' + f"{agent['employee_id']},2032-04,ALL,,,2,25\n{agent['employee_id']},2032-04,ALL,,,2,25"
    body = {'filename':'targets.csv','content_base64':base64.b64encode(text.encode()).decode(),'apply':True}
    assert client.post('/api/sales-management/targets/file',json=body).status_code == 422
    assert client.get('/api/sales-management/targets?period=2032-04').json() == []
    for invalid in ['-1', '2.5', '=SUM(1)', '10001']:
        text = ','.join(TARGET_COLUMNS) + '\n' + f"{agent['employee_id']},2032-04,ALL,,,2,{invalid}"
        body['content_base64'] = base64.b64encode(text.encode()).decode()
        assert client.post('/api/sales-management/targets/file',json=body).status_code == 422


def test_sales_manager_snapshot_and_full_report(client):
    from app.db import Role, User, Outlet
    from app.security import password_hash
    from uuid import uuid4
    login(client)
    agent = client.get('/api/resources/agents').json()[0]
    with DB() as db:
        existing = db.scalars(select(User).join(Role).where(Role.name=='Sales Manager',User.branch_id==agent['branch_id'])).all()
        previous = [(person.id,person.branch_id) for person in existing]
        for person in existing:
            person.branch_id = None
        manager = User(name='Historical Sales Manager',email=f'snapshot-{uuid4()}@relay.demo',password_hash=password_hash('test-client-password'),role_id=db.scalar(select(Role.id).where(Role.name=='Sales Manager')),branch_id=agent['branch_id'])
        db.add(manager)
        db.commit()
        manager_id, manager_email = manager.id, manager.email
    try:
        row = client.post('/api/sales-management/sales',json={'agent_id':agent['id'],'order_type':'NEW','customer_name':'Report Customer','plan_name':'Captured plan','document_number':'784123456789123','request_id':f'REPORT-{uuid4()}','account_number':'ACCOUNT-123','sr_number':'SR-123','alternate_number':'0500000000'}).json()
        assert row['manager_id'] == manager_id
        with DB() as db:
            db.get(User,manager_id).branch_id = next(outlet.branch_id for outlet in db.scalars(select(Outlet)) if outlet.branch_id != agent['branch_id'])
            db.commit()
        login(client,manager_email.split('@')[0])
        assert client.get(f"/api/sales-management/sales/{row['id']}").json()['manager_id'] == manager_id
        report = client.get('/api/sales-management/export?format=xlsx')
        from openpyxl import load_workbook
        book = load_workbook(io.BytesIO(report.content))
        columns = list(next(book.active.values))
        assert {'sales_manager','router_serial','sr_number','tele_status','tele_remark','welcome_status','welcome_remark'} <= set(columns)
        assert '784123456789123' not in str(list(book.active.values))
        assert client.get('/api/sales-management/sales?branch_id=not-allowed').json() == []
    finally:
        with DB() as db:
            for identifier, branch in previous:
                db.get(User,identifier).branch_id = branch
            db.commit()


@pytest.mark.parametrize('account',['leader','leader2','cluster','compliance','inventory','salesmanager'])
def test_reporting_roles_cannot_create_sales_or_feedback(client, account):
    login(client, account)
    assert client.post('/api/sales-management/sales',json={'agent_id':'any','order_type':'NEW','customer_name':'Not allowed','plan_name':'Plan'}).status_code == 403
    assert client.post('/api/sales-management/feedback',json={'agent_id':'any','product_suggested':'Plan','feedback':'Customer feedback','rejection_reason':'No purchase'}).status_code == 403


def test_order_parser_captures_proposal_fields_without_guessing_type():
    from app.captures import order_fields
    parsed = order_fields([{'text':text} for text in ['Order Type: HW','Account Number: A123','Router Serial Number: ROUTER123','SIM Serial Number: SIM123','SR Number: SR123','Request Id: REQ123','MSISDN: 0500000000']])
    assert parsed['order_type']=='HW' and parsed['account_number']=='A123' and parsed['router_serial']=='ROUTER123'
    assert parsed['sim_identifier']=='SIM123' and parsed['sr_number']=='SR123'
    assert 'order_type' not in order_fields([{'text':'Order Type: random text'}])


def test_backend_review_closes_external_sale_and_consumes_stock_once(client):
    from app import captures
    from app.db import KycCapture, SalesRecord, Sim, Notification, Movement
    from app.sales_management import register_capture_sale
    from uuid import uuid4
    login(client)
    with DB() as db:
        agent = db.scalar(select(Agent).where(Agent.employee_id=='RLY-1041'))
        plan_id = client.get('/api/resources/plans').json()[0]['id']
        serial = f'SIM-{uuid4()}'
        sim = Sim(serial=serial,iccid=serial,sim_type='POSTPAID',agent_id=agent.id,outlet_id=agent.outlet_id,status='AVAILABLE')
        db.add(sim)
        capture = KycCapture(agent_id=agent.id,creator_id=agent.user_id,operation_id=str(uuid4()),source_reference=f'FLOW-{uuid4()}',image_hash='test',image_type='image/png',image_encrypted=captures.cipher.encrypt(b'test').decode(),status='SUBMITTED',version=1)
        captures.store(capture,{'document_kind':'PAYMENT_CONFIRMATION','intake':{'capture_mode':'SCREENSHOT_ORDER','order_type':'NEW','name':'Flow Customer','document_number':'SAMPLE','nationality':'Sample','birth_date':'1990-01-01','expiry_date':'2090-01-01','document_image':'','order_image':'','plan_id':plan_id,'msisdn':'0500000000','order_reference':f'ORDER-{uuid4()}','sim_identifier':serial},'rows':[],'history':[]})
        # Review complete() checks required image presence, not authenticity; extraction evidence is tested separately.
        data = captures.payload(capture)
        data['intake']['document_image']='stored'
        data['intake']['order_image']='stored'
        # Use a valid synthetic image for the intake validator.
        from PIL import Image
        image = io.BytesIO()
        Image.new('RGB',(80,80),'white').save(image,format='PNG')
        data['intake']['document_image']=base64.b64encode(image.getvalue()).decode()
        data['intake']['order_image']=data['intake']['document_image']
        captures.store(capture,data)
        db.add(capture)
        db.flush()
        register_capture_sale(db,capture)
        db.commit()
        capture_id, sim_id = capture.id, sim.id
        sale_id = db.scalar(select(SalesRecord.id).where(SalesRecord.capture_id==capture_id))
        leader_id = agent.leader_id
    rejected = client.post('/api/sales-management/status-file',json={'filename':'sales.csv','content_base64':base64.b64encode(f'sale_id,current_status,new_status\n{sale_id},IN_PROGRESS,CLOSED'.encode()).decode(),'apply':True})
    assert rejected.status_code == 422
    response = client.post(f'/api/kyc-captures/{capture_id}/review',json={'version':1,'outcome':'VERIFIED','reason':'External activation evidence checked'})
    assert response.status_code == 200, response.text
    assert client.get(f'/api/sales-management/sales/{sale_id}').json()['status']=='CLOSED'
    assert response.json()['invoice']['status']=='Verified'
    assert client.post(f'/api/kyc-captures/{capture_id}/review',json={'version':response.json()['version'],'outcome':'VERIFIED','reason':'Repeated review'}).status_code == 409
    with DB() as db:
        assert db.get(Sim,sim_id).status=='ACTIVATED'
        assert len(db.scalars(select(Movement).where(Movement.sim_id==sim_id)).all())==1
        assert db.scalar(select(Notification.id).where(Notification.user_id==leader_id,Notification.message.contains('FLOW-')))


@pytest.fixture(scope="module", autouse=True)
def database():
    Base.metadata.create_all(engine)
    seed()
    yield
    engine.dispose()


@pytest.fixture
def client():
    limits.clear()
    with TestClient(app) as c:
        yield c


def login(client, account="admin"):
    r = client.post(
        "/api/auth/login",
        json={"email": account + "@relay.demo", "password": "test-client-password", "native": True},
    )
    assert r.status_code == 200
    client.headers["Authorization"] = "Bearer " + r.json()["access_token"]
    return r.json()


def read_fixture_document(client, encoded, name="Sample Customer", number="SAMPLE-ONLY"):
    from app import captures
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(captures.extractor, "extract", lambda _: {"lines": [
            {"text":"Identity document"}, {"text": f"Full name: {name}"}, {"text": f"Document number: {number}"},
            {"text": "Date of birth: 1990-01-01"}, {"text": "Expiry date: 2090-12-31"},
        ]})
        return client.post("/api/kyc-captures/read-document", json={"image_base64":encoded}).json()["document_check"]


@pytest.mark.parametrize(
    "account,count",
    [
        ("admin", 12),
        ("ops", 12),
        ("leader", 9),
        ("leader2", 3),
        ("cluster", 9),
        ("agent1", 1),
        ("compliance", 12),
        ("inventory", 12),
    ],
)
def test_roles_and_scope(client, account, count):
    data = login(client, account)
    assert "activation.write" not in data["user"]["permissions"]
    assert ("inventory.write" in data["user"]["permissions"]) == (
        account in {"admin", "ops", "inventory"}
    )
    assert len(client.get("/api/resources/agents").json()) == count
    assert client.get("/api/dashboard").status_code == 200


def test_qanawat_subscriber_plans_are_available_to_field_agents(client):
    login(client, "agent1")
    response = client.get("/api/resources/plans")
    assert response.status_code == 200
    plans = {p["name"]: p for p in response.json()}
    assert set(plans) == {
        "5G Unlimited Ultra",
        "Flexi Postpaid",
        "Tourist Prepaid",
        "Enterprise M2M",
    }
    assert {name: plans[name]["monthly_cost"] for name in plans} == {
        "5G Unlimited Ultra": 350,
        "Flexi Postpaid": 250,
        "Tourist Prepaid": 199,
        "Enterprise M2M": 85,
    }
    assert {name: plans[name]["promotion"] for name in plans} == {
        "5G Unlimited Ultra": "Unlimited 5G Data + 1500 Flexi Mins",
        "Flexi Postpaid": "100GB 5G Data + 500 Local Mins",
        "Tourist Prepaid": "50GB High Speed + Free Roaming",
        "Enterprise M2M": "Telemetry VPN + Fixed IP",
    }


def test_admin_can_manage_plans_and_changes_reach_the_shared_catalog(client):
    login(client)
    current = client.get("/api/admin/plans")
    assert current.status_code == 200
    assert len(current.json()) == 4
    body = {
        "name": "QA Flexible Plan",
        "monthly_cost": 129.5,
        "data_gb": 30,
        "speed": "5G",
        "roaming": "1 GB",
        "contract": "12 months",
        "promotion": "30 GB data + 300 minutes",
        "advance": 0,
        "vat": 5,
        "active": True,
    }
    created = client.post("/api/plans", json=body)
    assert created.status_code == 201, created.text
    plan_id = created.json()["id"]
    assert any(p["id"] == plan_id for p in client.get("/api/resources/plans").json())
    assert client.post("/api/plans", json=body).status_code == 409

    body.update(name="QA Flexible Plus", monthly_cost=149.5)
    changed = client.patch(f"/api/plans/{plan_id}", json=body)
    assert changed.status_code == 200
    assert changed.json()["name"] == "QA Flexible Plus"
    assert changed.json()["monthly_cost"] == 149.5
    assert any(
        p["name"] == "QA Flexible Plus" for p in client.get("/api/resources/plans").json()
    )

    body["active"] = False
    removed = client.patch(f"/api/plans/{plan_id}", json=body)
    assert removed.status_code == 200 and removed.json()["active"] is False
    assert all(p["id"] != plan_id for p in client.get("/api/resources/plans").json())
    assert any(p["id"] == plan_id for p in client.get("/api/admin/plans").json())

    body["active"] = True
    assert client.patch(f"/api/plans/{plan_id}", json=body).json()["active"] is True
    with DB() as db:
        actions = [a.action for a in db.scalars(select(Audit).where(Audit.entity == plan_id))]
    assert "Plan Created" in actions
    assert "Plan Changed" in actions
    assert "Plan Removed" in actions
    assert "Plan Restored" in actions
    deleted = client.request("DELETE", f"/api/plans/{plan_id}", json={"reason": "Unused plan retired"})
    assert deleted.status_code == 200, deleted.text
    assert all(p["id"] != plan_id for p in client.get("/api/admin/plans").json())
    with DB() as db:
        assert db.scalar(select(Audit).where(Audit.entity == plan_id, Audit.action == "Plan Permanently Deleted"))


def test_plan_management_is_restricted_to_administrators(client):
    login(client, "agent1")
    assert client.get("/api/admin/plans").status_code == 403
    assert client.request("DELETE", "/api/plans/unknown", json={"reason": "Not authorized"}).status_code == 403


def test_referenced_plan_cannot_be_permanently_deleted(client):
    login(client)
    with DB() as db:
        plan_id = db.scalar(select(Order.plan_id).where(Order.plan_id.is_not(None)).limit(1))
    assert plan_id
    assert client.request("DELETE", f"/api/plans/{plan_id}", json={"reason": "Attempted plan deletion"}).status_code == 409


def test_public_plans_catalog_is_read_only_and_requires_no_account(client):
    response = client.get("/api/public/plans")
    assert response.status_code == 200
    from app.db import Plan
    with DB() as db:
        assert {p["id"] for p in response.json()} == set(db.scalars(select(Plan.id).where(Plan.active.is_(True))))
    assert client.post("/api/public/plans", json={}).status_code == 405


def test_field_tasks_are_not_in_the_client_edition(client):
    login(client)
    assert client.get("/api/field-tasks").status_code == 404
    assert client.post("/api/field-tasks", json={}).status_code == 404
    assert client.get("/api/resources/compliance").status_code == 404


def test_support_ticket_is_scoped_and_review_is_audited(client):
    login(client, "agent1")
    agent_id = client.get("/api/auth/me").json()["agent_id"]
    opened = client.post(
        "/api/support-tickets",
        json={
            "agent_id": agent_id,
            "subject": "Device sync delay",
            "message": "Synthetic field issue for testing",
        },
    )
    assert opened.status_code == 201, opened.text
    ticket_id = opened.json()["id"]
    assert opened.json()["status"] == "OPEN"
    assert (
        client.patch(
            f"/api/support-tickets/{ticket_id}", json={"status": "RESOLVED", "response": "Resolved"}
        ).status_code
        == 403
    )
    login(client, "agent2")
    assert all(row["id"] != ticket_id for row in client.get("/api/support-tickets").json())
    assert client.post("/api/support-tickets", json={
        "agent_id": agent_id, "subject": "Wrong agent", "message": "Cannot open for another agent",
    }).status_code == 403
    login(client, "leader2")
    assert (
        client.patch(
            f"/api/support-tickets/{ticket_id}", json={"status": "RESOLVED", "response": "Resolved"}
        ).status_code
        == 404
    )
    login(client, "ops")
    resolved = client.patch(
        f"/api/support-tickets/{ticket_id}",
        json={"status": "RESOLVED", "response": "Restarted sync process"},
    )
    assert resolved.status_code == 200 and resolved.json()["status"] == "RESOLVED"
    login(client)
    assert client.post("/api/support-tickets", json={
        "agent_id": agent_id, "subject": "Admin request", "message": "Administrators only respond",
    }).status_code == 403
    login(client, "ops")
    assert (
        client.patch(
            f"/api/support-tickets/{ticket_id}", json={"status": "RESOLVED", "response": "Again"}
        ).status_code
        == 409
    )
    with DB() as db:
        assert db.scalar(
            select(Audit).where(Audit.entity == ticket_id, Audit.action == "Support Ticket Updated")
        )


def test_proposal_incentive_import_validates_whole_batch_and_preserves_amount(client):
    login(client)
    agent = client.get("/api/resources/agents").json()[0]
    manual = client.post(
        "/api/incentives",
        json={
            "agent_id": agent["id"],
            "period": "2026-09",
            "amount": "125.50",
            "note": "Demo target",
        },
    )
    assert manual.status_code == 201 and manual.json()["amount"] == "125.50"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["employee_id", "period", "amount", "note"])
    sheet.append([agent["employee_id"], "2026-09", "30.25", "Synthetic example"])
    sheet.append(["INVALID-EMPLOYEE", "2026-09", "50.00", "Bad row"])
    output = io.BytesIO()
    workbook.save(output)
    payload = {
        "filename": "incentives.xlsx",
        "content_base64": base64.b64encode(output.getvalue()).decode(),
    }
    before = len(client.get("/api/incentives").json())
    invalid = client.post("/api/incentives/import", json=payload)
    assert invalid.status_code == 422 and len(client.get("/api/incentives").json()) == before
    sheet.cell(3, 1).value = agent["employee_id"]
    output = io.BytesIO()
    workbook.save(output)
    payload["content_base64"] = base64.b64encode(output.getvalue()).decode()
    imported = client.post("/api/incentives/import", json=payload)
    assert imported.status_code == 201 and imported.json()["count"] == 2
    retry = client.post("/api/incentives/import", json=payload)
    assert retry.status_code == 201 and retry.json()["already_imported"] is True
    assert len(client.get("/api/incentives").json()) == before + 2
    assert client.get("/api/incentives/export?period=2026-09").status_code == 200
    login(client, "agent1")
    own = client.get("/api/incentives").json()
    assert own and all(x["agent_id"] == own[0]["agent_id"] for x in own)
    assert (
        client.post(
            "/api/incentives", json={"agent_id": agent["id"], "period": "2026-09", "amount": "20"}
        ).status_code
        == 403
    )


def test_proposal_customer_lookup_and_stock_move(client):
    login(client)
    assert client.get("/api/resources/customers").status_code == 200
    agents = client.get("/api/resources/agents").json()
    sims = client.get("/api/resources/inventory").json()
    source = next(
        s for s in sims if s["status"] == "AVAILABLE" and s["agent_id"] == agents[0]["id"]
    )
    target = next(a for a in agents if a["id"] != source["agent_id"])
    moved = client.post(
        f"/api/inventory/{source['id']}/move",
        json={"status": "AVAILABLE", "agent_id": target["id"], "reason": "Demo stock transfer"},
    )
    assert moved.status_code == 200 and moved.json()["agent_id"] == target["id"]
    with DB() as db:
        assert db.scalar(
            select(Audit).where(Audit.entity == source["id"], Audit.action == "Stock Transferred")
        )


def test_agent_can_report_own_stock_but_not_reassign_or_change_others(client):
    login(client, "agent1")
    own_agent = client.get("/api/auth/me").json()["agent_id"]
    own_sim = next(
        s
        for s in client.get("/api/resources/inventory").json()
        if s["agent_id"] == own_agent and s["status"] == "AVAILABLE"
    )
    login(client, "agent2")
    assert (
        client.post(
            f"/api/inventory/{own_sim['id']}/move",
            json={"status": "DAMAGED", "reason": "Broken in field"},
        ).status_code
        == 404
    )
    login(client, "agent1")
    assert (
        client.post(
            f"/api/inventory/{own_sim['id']}/move",
            json={"status": "WAREHOUSE", "reason": "Not allowed"},
        ).status_code
        == 403
    )
    moved = client.post(
        f"/api/inventory/{own_sim['id']}/move",
        json={"status": "DAMAGED", "reason": "Damaged connector"},
    )
    assert moved.status_code == 200 and moved.json()["status"] == "DAMAGED"
    assert (
        client.post(
            f"/api/inventory/{own_sim['id']}/move",
            json={"status": "RETURNED", "reason": "Another change"},
        ).status_code
        == 409
    )
    with DB() as db:
        assert db.scalar(
            select(Audit).where(Audit.entity == own_sim["id"], Audit.action == "Stock Transferred")
        )


@pytest.mark.parametrize(
    "path",
    [
        "/api/orders/draft",
        "/api/orders/x/submit",
        "/api/roles",
        "/api/resources/orders",
    ],
)
def test_extra_capabilities_unavailable(client, path):
    login(client)
    for method in ["GET", "POST", "PATCH"]:
        assert client.request(method, path, json={}).status_code in {404, 405}


def test_unrelated_identity_simulation_is_not_in_proposal_api(client):
    login(client, "agent1")
    assert client.post("/api/ekyc/verify", json={}).status_code == 404
    assert "/api/ekyc/verify" not in client.get("/openapi.json").json()["paths"]


@pytest.mark.parametrize(
    "report",
    ["daily", "monthly", "agent", "team", "ekyc", "branch", "inventory", "failed", "audit"],
)
def test_csv_and_compliance_pdf_scope(client, report):
    login(client)
    assert client.get("/api/reports/" + report + "?format=csv").status_code == 200
    r = client.get("/api/reports/" + report + "?format=pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")


def test_readonly_records_and_api_contract(client):
    assert client.get("/api/dashboard").status_code == 401
    login(client)
    row = client.get("/api/resources/activations").json()[0]
    r = client.get("/api/activations/" + row["id"])
    assert r.status_code == 200 and r.json()["events"]
    paths = client.get("/openapi.json").json()["paths"]
    assert not any("/orders" in p or "/roles" in p for p in paths)


def test_location_collection_is_removed(client):
    data = login(client, "agent1")
    assert "location.write" not in data["user"]["permissions"]
    a = client.get("/api/resources/agents").json()[0]
    assert not {"lat", "lng", "accuracy", "geofence", "distance"} & a.keys()
    assert (
        client.post(
            f"/api/agents/{a['id']}/location", json={"lat": 25, "lng": 55, "accuracy": 10}
        ).status_code
        == 404
    )
    for resource in ("locations", "territories"):
        assert client.get("/api/resources/" + resource).status_code == 404
    assert client.get("/api/reports/geofence").status_code == 404
    assert not any(
        "/location" in p or "/territories" in p for p in client.get("/openapi.json").json()["paths"]
    )


def test_branch_filters_intersect_role_scope_and_charts_reconcile(client):
    login(client)
    branches = client.get("/api/resources/branches").json()
    assert len(branches) == 2
    total = 0
    for b in branches:
        d = client.get("/api/dashboard", params={"branch_id": b["id"]}).json()
        assert all(a["branch_id"] == b["id"] for a in d["agents"])
        assert all(t["branch_id"] == b["id"] for t in d["teams"])
        assert sum(r["value"] for r in d["capture_statuses"]) == d["capture_total"]
        assert sum(t["agents"] for t in d["teams"]) == len(d["agents"])
        total += len(d["agents"])
        csv = client.get("/api/reports/team", params={"branch_id": b["id"]}).text
        assert b["name"] in csv
    assert total == 12
    login(client, "agent1")
    own = client.get("/api/resources/agents").json()[0]
    foreign = next(b for b in branches if b["id"] != own["branch_id"])
    d = client.get("/api/dashboard", params={"branch_id": foreign["id"]}).json()
    assert d["agents"] == [] and d["capture_total"] == 0 and d["today"] == 0
    assert (
        client.get("/api/resources/team-leaders", params={"branch_id": foreign["id"]}).json() == []
    )


def test_multibyte_password_does_not_cause_server_error(client):
    r = client.post("/api/auth/login", json={"email": "admin@relay.demo", "password": "🔒" * 60})
    assert r.status_code == 401


def test_team_kpis_are_weighted_by_actual_records(client):
    from app.db import Ekyc, business_date

    login(client)
    teams = client.get("/api/resources/team-leaders").json()
    agents = client.get("/api/resources/agents").json()
    with DB() as db:
        for team in teams:
            members = {
                a["id"]
                for a in agents
                if a["leader_id"] == team["leader_id"] and a["branch_id"] == team["branch_id"]
            }
            checks = list(db.scalars(select(Ekyc).where(Ekyc.agent_id.in_(members))))
            orders = [
                o
                for o in db.scalars(
                    select(Order).where(Order.agent_id.in_(members), Order.status == "ACTIVATED")
                )
                if business_date(o.created_at) == business_date()
            ]
            assert team["aht"] == round(
                sum(o.handling_seconds for o in orders) / max(1, len(orders)) / 60, 1
            )
            assert team["ekyc_rate"] == round(
                sum(e.status == "VERIFIED" for e in checks) / max(1, len(checks)) * 100, 1
            )


@pytest.mark.parametrize("dynamic", [False, True])
def test_capture_lifecycle_access_and_excel(client, monkeypatch, dynamic):
    import base64
    import io
    from PIL import Image
    from openpyxl import load_workbook
    from app import captures
    from app.db import KycCapture

    monkeypatch.setattr(
        captures.extractor,
        "extract",
        lambda _: {
            "engine": "Test",
            "lines": [{"text": "TXN-001 Jordan Demo Data Plan", "confidence": 96.2}],
            "rows": [],
            "history": [],
        },
    )
    login(client, "agent1")
    agent = client.get("/api/auth/me").json()["agent_id"]
    image = io.BytesIO()
    Image.new("RGB", (400, 200), "white").save(image, format="PNG")
    body = {
        "agent_id": agent,
        "operation_id": str(__import__("uuid").uuid4()),
        "source_reference": "DEMO-CAPTURE",
        "image_base64": base64.b64encode(image.getvalue()).decode(),
    }
    created = client.post("/api/kyc-captures", json=body)
    assert created.status_code == 201, created.text
    row = created.json()
    path = "/api/kyc-captures/" + row["id"]
    assert client.post("/api/kyc-captures", json=body).json()["id"] == row["id"]
    assert client.post(path + "/submit", json={"version": row["version"]}).status_code == 409
    captures.process_capture()
    row = client.get(path).json()
    assert row["status"] == "EXTRACTED"
    assert client.get(path + "/original").content == image.getvalue()
    with DB() as db:
        stored = db.get(KycCapture, row["id"])
        assert "TXN-001" not in stored.payload_encrypted
        assert stored.image_encrypted.startswith("gAAAA")
    items = [
        {
            "reference": "=HYPERLINK(1)",
            "customer": "Jordan Demo",
            "account": "0000123",
            "details": "Data plan",
            "source_line": 0,
        }
    ]
    if dynamic:
        items = [{"fields": [{"label": "New arbitrary field", "value": "=HYPERLINK(1)", "source_line": 0}, {"label": "Account", "value": "0000123"}, {"label": "Fee", "value": "10"}, {"label": "Fee", "value": "20"}], "source_line": 0}]
    invalid = [{"fields": [{"label": " ", "value": "x"}]}] if dynamic else items + items
    assert client.patch(path + "/rows", json={"version": row["version"], "rows": invalid, "reason": "Reviewed image"}).status_code == 422
    saved = client.patch(
        path + "/rows", json={"version": row["version"], "rows": items, "reason": "Reviewed image"}
    )
    assert saved.status_code == 200, saved.text
    assert (
        client.patch(
            path + "/rows",
            json={"version": row["version"], "rows": items, "reason": "Reviewed image"},
        ).status_code
        == 409
    )
    row = saved.json()
    sheet = load_workbook(io.BytesIO(client.get(path + "/excel").content)).active
    if dynamic:
        assert sheet["C2"].data_type == "s" and sheet["C2"].value == "=HYPERLINK(1)"
        assert sheet["C3"].value == "0000123"
        assert sheet["B4"].value == sheet["B5"].value == "Fee"
    else:
        assert sheet["A2"].data_type == "s" and sheet["C2"].value == "0000123"
    row = client.post(path + "/submit", json={"version": row["version"]}).json()
    assert row["status"] == "SUBMITTED"
    assert (
        client.post(
            path + "/review",
            json={"version": row["version"], "outcome": "VERIFIED", "reason": "Checked original"},
        ).status_code
        == 403
    )
    login(client, "agent2")
    assert client.get(path).status_code == 404
    login(client, "inventory")
    assert client.get(path).status_code == 403
    login(client, "compliance")
    reviewed = client.post(
        path + "/review",
        json={
            "version": row["version"],
            "outcome": "VERIFIED",
            "reason": "Checked original screenshot",
        },
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "VERIFIED"
    login(client, "agent1")
    assert client.get(path).json()["status"] == "VERIFIED"
    assert (
        client.post(
            "/api/kyc-captures",
            json={
                **body,
                "operation_id": str(__import__("uuid").uuid4()),
                "image_base64": base64.b64encode(b"not an image").decode(),
            },
        ).status_code
        == 422
    )


def test_capture_label_mapping_does_not_invent_fields():
    from app.capture_ocr import organize_lines

    lines = [
        {"text": text}
        for text in [
            "Transaction Reference: DEMO-01",
            "Customer: Jordan Demo",
            "Account: 0000123",
            "Plan: Essential 125",
            "Transaction ID: DEMO-02",
            "Customer: Avery Demo",
        ]
    ]
    rows = organize_lines(lines)
    assert len(rows) == 1
    assert rows[0]["fields"][2]["value"] == "0000123"
    assert rows[0]["fields"][3]["label"] == "Plan"
    assert len(rows[0]["fields"]) == len(lines)
    assert organize_lines([{"text": "Unrecognized layout"}])[0]["fields"][0]["value"] == "Unrecognized layout"
    repeated = organize_lines([{"text": "Transaction ID: 1"}, {"text": "VAT: 5"}, {"text": "Transaction ID: 2"}])
    assert len(repeated) == 2


def test_admin_management_validation_conflicts_and_permissions(client):
    login(client)
    a = next(
        row
        for row in client.get("/api/resources/agents").json()
        if row["employee_id"] == "RLY-1041"
    )
    path = f"/api/agents/{a['id']}/management"
    options = client.get(path).json()
    body = {
        "target": a["target"] + 1,
        "outlet_id": a["outlet_id"],
        "leader_id": a["leader_id"],
        "expected_target": a["target"],
        "expected_outlet_id": a["outlet_id"],
        "expected_leader_id": a["leader_id"],
        "reason": "Admin control audit test",
    }
    assert client.patch(path, json={**body, "target": 0}).status_code == 422
    wrong = next(leader for leader in options["leaders"] if leader["branch_id"] != a["branch_id"])
    assert client.patch(path, json={**body, "leader_id": wrong["id"]}).status_code == 422
    other = next(
        o
        for o in options["outlets"]
        if o["id"] != a["outlet_id"] and o["branch_id"] == a["branch_id"]
    )
    assert client.patch(path, json={**body, "outlet_id": other["id"]}).status_code == 409
    result = client.patch(path, json=body)
    assert result.status_code == 200, result.text
    assert result.json()["target"] == body["target"]
    roster = client.get("/api/resources/agents").json()
    assert [r["employee_id"] for r in roster] == sorted(r["employee_id"] for r in roster)
    assert client.patch(path, json=body).status_code == 409
    assert any(
        x["action"] == "Agent Assignment Changed" for x in client.get("/api/resources/audit").json()
    )
    assert (
        client.patch(
            path, json={**body, "expected_target": body["target"], "target": a["target"]}
        ).status_code
        == 200
    )
    for account in ["agent1", "leader", "compliance"]:
        login(client, account)
        assert client.get(path).status_code == 403
        assert client.patch(path, json=body).status_code == 403


def test_capture_filters_validate_and_preserve_scope(client):
    login(client)
    assert client.get("/api/kyc-captures?status=INVALID").status_code == 422
    assert client.get("/api/kyc-captures?offset=-1").status_code == 422
    all_rows = client.get("/api/kyc-captures?limit=100").json()
    first = client.get("/api/kyc-captures?limit=1").json()
    second = client.get("/api/kyc-captures?limit=1&offset=1").json()
    assert first == all_rows[:1] and second == all_rows[1:2]
    if all_rows:
        row = all_rows[0]
        match = client.get(
            "/api/kyc-captures", params={"search": row["source_reference"], "status": row["status"]}
        ).json()
        assert row in match
    assert client.get("/api/kyc-captures?search=NO-SUCH-CAPTURE-987654321").json() == []
    login(client, "agent2")
    own = client.get("/api/resources/agents").json()[0]["id"]
    rows = client.get("/api/kyc-captures?status=VERIFIED&limit=100").json()
    assert all(r["agent_id"] == own for r in rows)


def test_capture_history_reaches_beyond_fifty_without_leaking_other_agents(client):
    import uuid
    from sqlalchemy import delete
    from app.db import KycCapture
    from app.security import cipher

    login(client)
    agents = client.get("/api/resources/agents").json()
    own = next(a for a in agents if a["employee_id"] == "RLY-1041")
    other = next(a for a in agents if a["employee_id"] == "RLY-1042")
    ids = []
    with DB() as db:
        for i in range(62):
            row = KycCapture(
                agent_id=own["id"] if i < 61 else other["id"],
                creator_id=own["user_id"],
                operation_id=str(uuid.uuid4()),
                source_reference=f"AUDIT-PAGE-{i:02}",
                status="SUBMITTED",
                image_type="image/png",
                image_hash=str(i).zfill(64),
                image_encrypted=cipher.encrypt(b"synthetic").decode(),
            )
            db.add(row)
            db.flush()
            ids.append(row.id)
        db.commit()
    try:
        pages = [
            client.get(f"/api/kyc-captures?search=AUDIT-PAGE&limit=20&offset={offset}").json()
            for offset in (0, 20, 40, 60)
        ]
        assert [len(page) for page in pages] == [20, 20, 20, 2]
        assert len({r["id"] for page in pages for r in page}) == 62
        login(client, "agent1")
        rows = client.get("/api/kyc-captures?search=AUDIT-PAGE&limit=100").json()
        assert len(rows) == 61 and all(r["agent_id"] == own["id"] for r in rows)
    finally:
        with DB() as db:
            db.execute(delete(KycCapture).where(KycCapture.id.in_(ids)))
            db.commit()


def test_organization_setup_is_atomic_scoped_and_audited(client):
    login(client, "agent1")
    assert client.get("/api/organization").status_code == 403
    assert client.post("/api/organization/branches", json={"name": "Forbidden"}).status_code == 403
    login(client)
    branch = client.post("/api/organization/branches", json={"name": "Synthetic setup branch"})
    assert branch.status_code == 201, branch.text
    branch_id = branch.json()["id"]
    assert (
        client.post(
            "/api/organization/branches", json={"name": "SYNTHETIC SETUP BRANCH"}
        ).status_code
        == 409
    )
    assert any(b["id"] == branch_id for b in client.get("/api/resources/branches").json())
    team = client.post(
        "/api/organization/teams",
        json={
            "name": "Setup Leader",
            "branch_id": branch_id,
            "email": "setup.leader@relay.demo",
            "password": "test-client-password",
        },
    )
    assert team.status_code == 201, team.text
    leader_id = team.json()["id"]
    assert any(
        t["leader_id"] == leader_id and t["agents"] == 0
        for t in client.get("/api/resources/team-leaders").json()
    )
    outlet = client.post(
        "/api/organization/outlets", json={"name": "Setup outlet", "branch_id": branch_id}
    )
    assert outlet.status_code == 201
    payload = {
        "name": "Setup Agent",
        "branch_id": branch_id,
        "leader_id": leader_id,
        "outlet_id": outlet.json()["id"],
        "employee_id": "SETUP-01",
        "email": "setup.agent@relay.demo",
        "password": "test-client-password",
        "target": 25,
    }
    other = next(
        o for o in client.get("/api/organization").json()["outlets"] if o["branch_id"] != branch_id
    )
    assert (
        client.post(
            "/api/organization/agents", json={**payload, "outlet_id": other["id"]}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/organization/agents", json={**payload, "password": "short"}).status_code
        == 422
    )
    created = client.post("/api/organization/agents", json=payload)
    assert created.status_code == 201, created.text
    assert client.post("/api/organization/agents", json=payload).status_code == 409
    with DB() as db:
        event = db.scalar(select(Audit).where(Audit.entity == created.json()["id"]))
        assert event is not None
        assert "password" not in str(event.new_value)
    login(client, "setup.agent")
    agents = client.get("/api/resources/agents").json()
    assert len(agents) == 1 and agents[0]["id"] == created.json()["id"]
    login(client, "setup.leader")
    assert len(client.get("/api/resources/agents").json()) == 1
    login(client, "leader")
    assert not any(
        a["id"] == created.json()["id"] for a in client.get("/api/resources/agents").json()
    )


def test_agent_can_be_assigned_directly_to_a_branch(client):
    login(client)
    branch = client.post("/api/organization/branches", json={"name": "Direct Agent Branch"})
    assert branch.status_code == 201, branch.text
    payload = {
        "name": "Direct Agent",
        "branch_id": branch.json()["id"],
        "employee_id": "DIRECT-01",
        "email": "direct.agent@relay.demo",
        "password": "test-client-password",
        "target": 18,
    }
    created = client.post("/api/organization/agents", json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["branch_id"] == branch.json()["id"]
    with DB() as db:
        assert db.get(Agent, created.json()["id"]).leader_id is None
    login(client, "direct.agent")
    assert [a["id"] for a in client.get("/api/resources/agents").json()] == [created.json()["id"]]


def test_failed_image_extraction_can_be_completed_manually(client):
    from PIL import Image
    from uuid import uuid4
    from app.db import KycCapture

    login(client, "agent1")
    agent_id = client.get("/api/auth/me").json()["agent_id"]
    image = io.BytesIO()
    Image.new("RGB", (400, 200), "white").save(image, format="PNG")
    encoded = base64.b64encode(image.getvalue()).decode()
    plan_id = client.get("/api/resources/plans").json()[0]["id"]
    created = client.post("/api/kyc-captures", json={
        "agent_id": agent_id, "operation_id": str(uuid4()),
        "source_reference": "MANUAL-CORRECTION-CASE", "image_base64": encoded,
        "intake": {"name": "Sample Customer", "document_number": "SAMPLE-ONLY",
                   "nationality": "Sample", "birth_date": "1990-01-01",
                   "expiry_date": "2090-12-31", "document_image": encoded,
                   "document_check": read_fixture_document(client, encoded),
                   "sim_identifier": "SAMPLE-SIM", "plan_id": plan_id,
                   "msisdn": "SAMPLE-PHONE", "signature": [[[i / 10, 0.5] for i in range(8)]]},
    })
    assert created.status_code == 201, created.text
    capture_id = created.json()["id"]
    with DB() as db:
        row = db.get(KycCapture, capture_id)
        row.status = "OCR_FAILED"
        db.commit()
    current = client.get(f"/api/kyc-captures/{capture_id}").json()
    saved = client.patch(f"/api/kyc-captures/{capture_id}/rows", json={
        "version": current["version"], "reason": "Read payment image manually",
        "rows": [{"fields": [{"label": "Total paid", "value": "AED 100.00"}]}],
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["status"] == "VALIDATED"


def test_excel_sim_import_is_atomic_and_audited(client):
    login(client)
    branch = client.get("/api/resources/branches").json()[0]
    template = client.get("/api/inventory/bulk-template")
    assert template.status_code == 200 and template.content[:2] == b"PK"

    def workbook(rows):
        book = Workbook()
        sheet = book.active
        sheet.append(["ICCID", "SIM Serial", "SIM Type"])
        for row in rows:
            sheet.append(row)
        stream = io.BytesIO()
        book.save(stream)
        return base64.b64encode(stream.getvalue()).decode()

    invalid = client.post("/api/inventory/bulk", json={
        "branch_id": branch["id"], "reason": "Received branch stock", "content_base64": workbook([
            ["QA-BULK-001", "QA-SERIAL-001", "Physical"],
            ["QA-BULK-001", "QA-SERIAL-002", "eSIM"],
        ])})
    assert invalid.status_code == 409
    valid = client.post("/api/inventory/bulk", json={
        "branch_id": branch["id"], "reason": "Received branch stock", "content_base64": workbook([
            ["QA-BULK-001", "QA-SERIAL-001", "Physical"],
            ["QA-BULK-002", "QA-SERIAL-002", "eSIM"],
        ])})
    assert valid.status_code == 201, valid.text
    assert valid.json()["imported"] == 2
    assert client.post("/api/inventory/bulk", json={
        "branch_id": branch["id"], "reason": "Received branch stock", "content_base64": workbook([
            ["QA-BULK-001", "QA-SERIAL-001", "Physical"],
        ])}).status_code == 409
    from app.db import Sim, Movement
    with DB() as db:
        sims = db.scalars(select(Sim).where(Sim.iccid.in_(["QA-BULK-001", "QA-BULK-002"]))).all()
        assert len(sims) == 2
        assert all(db.scalar(select(Movement.id).where(Movement.sim_id == sim.id)) for sim in sims)
        assert all(db.scalar(select(Audit.id).where(Audit.entity == sim.id, Audit.action == "SIM Imported")) for sim in sims)
    login(client, "agent1")
    assert client.get("/api/inventory/bulk-template").status_code == 403


def test_demo_refresh_is_opt_in_idempotent_and_preserves_history(monkeypatch):
    from app.demo_refresh import refresh_demo
    from app.db import Sim, Movement

    monkeypatch.delenv("RELAY_DEMO_REFRESH", raising=False)
    with pytest.raises(RuntimeError, match="explicit"):
        refresh_demo()
    with DB() as db:
        original = {o.id: (o.status, o.created_at) for o in db.scalars(select(Order)).all()}
    monkeypatch.setenv("RELAY_DEMO_REFRESH", "1")
    refresh_demo()
    with DB() as db:
        added = db.scalars(select(Order).where(Order.operation_id.like("demo-day-%"))).all()
        assert added
        added_ids = {o.id for o in added}
        for order in added:
            assert db.get(Sim, order.sim_id).agent_id == order.agent_id
            assert db.scalar(select(Movement.id).where(Movement.sim_id == order.sim_id))
            assert db.scalar(select(Audit.id).where(Audit.entity == order.id))
    refresh_demo()
    with DB() as db:
        assert {
            o.id for o in db.scalars(select(Order).where(Order.operation_id.like("demo-day-%")))
        } == added_ids
        assert all(
            (db.get(Order, key).status, db.get(Order, key).created_at) == value
            for key, value in original.items()
        )


def transaction_identity(client, monkeypatch, operation):
    from app.transactions import extractor

    lines = [
        {"text": line, "confidence": 98.2}
        for line in [
            "Name: Jordan Demo",
            "Document: DEMO-ID-1001",
            "Nationality: Synthetic UAE resident",
            "Expiry: 2030-12-31",
            "Date of birth: 1995-04-12",
        ]
    ]
    monkeypatch.setattr(extractor, "extract", lambda _: {"lines": lines})
    me = login(client, "agent1")["user"]
    r = client.post(
        "/api/transactions", json={"agent_id": me["agent_id"], "operation_id": operation}
    )
    assert r.status_code == 200, r.text
    tx = r.json()
    identifier = tx["id"]
    sample = client.get("/api/transactions/sample/id")
    assert sample.status_code == 200, sample.text
    r = client.post(
        f"/api/transactions/{identifier}/scan",
        json={"version": tx["version"], "document_type": "National Identity Card", **sample.json()},
    )
    assert r.status_code == 200, r.text
    tx = r.json()
    body = {k: tx["data"][k] for k in ["name", "document_number", "nationality", "expiry", "dob"]}
    r = client.post(
        f"/api/transactions/{identifier}/identity", json={"version": tx["version"], **body}
    )
    assert r.status_code == 200, r.text
    tx = r.json()
    r = client.post(
        f"/api/transactions/{identifier}/liveness",
        json={"version": tx["version"], "scenario": "pass"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_reference_transaction_all_stages_and_idempotent_submit(client, monkeypatch):
    from app.db import Sim, Movement, Activation
    from app.services import finish_pending
    from datetime import timedelta

    tx = transaction_identity(client, monkeypatch, "test-full-reference-journey")
    assert tx["stage"] == 2
    catalog = client.get("/api/transactions/catalog", params={"agent_id": tx["agent_id"]}).json()
    sim = catalog["sims"][0]
    signature = [[[i / 20, 0.3 + i / 100] for i in range(12)]]
    body = {
        "version": tx["version"],
        "sim_id": sim["id"],
        "plan_id": catalog["plans"][0]["id"],
        "msisdn": catalog["numbers"][0],
        "signature": signature,
    }
    invalid = client.post(
        f"/api/transactions/{tx['id']}/allocate", json={**body, "signature": [[[0.1, 0.1]]]}
    )
    assert invalid.status_code == 422
    r = client.post(f"/api/transactions/{tx['id']}/allocate", json=body)
    assert r.status_code == 200, r.text
    tx = r.json()
    r = client.post(f"/api/transactions/{tx['id']}/submit", json={"version": tx["version"]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "PROCESSING"
    again = client.post(f"/api/transactions/{tx['id']}/submit", json={"version": tx["version"]})
    assert again.status_code == 200
    assert client.get(f"/api/transactions/{tx['id']}/receipt").status_code == 409
    with DB() as db:
        assert db.get(Sim, sim["id"]).status == "RESERVED"
        assert (
            len(
                db.scalars(
                    select(Movement).where(
                        Movement.sim_id == sim["id"], Movement.new_status == "RESERVED"
                    )
                ).all()
            )
            == 1
        )
        order = db.get(Order, tx["id"])
        assert "Jordan Demo" not in str(order.draft)
        order.updated_at -= timedelta(seconds=15)
        db.commit()
    finish_pending()
    r = client.get(f"/api/transactions/{tx['id']}")
    assert r.json()["status"] == "ACTIVATED"
    assert client.get(f"/api/transactions/{tx['id']}/receipt").content.startswith(b"%PDF")
    assert client.post(f"/api/transactions/{tx['id']}/sms").json()["delivered"] is False
    with DB() as db:
        assert len(db.scalars(select(Activation).where(Activation.order_id == tx["id"])).all()) == 1


def test_reference_transaction_scope_stale_versions_and_stock_conflict(client, monkeypatch):
    from app.db import Sim

    tx = transaction_identity(client, monkeypatch, "test-reference-conflict")
    catalog = client.get("/api/transactions/catalog", params={"agent_id": tx["agent_id"]}).json()
    r = client.post(
        f"/api/transactions/{tx['id']}/liveness", json={"version": 1, "scenario": "pass"}
    )
    assert r.status_code == 409
    login(client, "agent2")
    assert client.get(f"/api/transactions/{tx['id']}").status_code in [403, 404]
    assert client.get(
        "/api/transactions/catalog", params={"agent_id": tx["agent_id"]}
    ).status_code in [403, 404]
    login(client, "agent1")
    sim = catalog["sims"][0]
    body = {
        "version": tx["version"],
        "sim_id": sim["id"],
        "plan_id": catalog["plans"][0]["id"],
        "msisdn": catalog["numbers"][0],
        "signature": [[[i / 20, 0.4] for i in range(12)]],
    }
    r = client.post(f"/api/transactions/{tx['id']}/allocate", json=body)
    assert r.status_code == 200
    with DB() as db:
        item = db.get(Sim, sim["id"])
        item.status = "RESERVED"
        db.commit()
    assert (
        client.post(
            f"/api/transactions/{tx['id']}/submit", json={"version": r.json()["version"]}
        ).status_code
        == 409
    )
    with DB() as db:
        item = db.get(Sim, sim["id"])
        item.status = "AVAILABLE"
        db.commit()


def test_reference_transaction_cannot_skip_identity(client):
    me = login(client, "agent1")["user"]
    tx = client.post(
        "/api/transactions",
        json={"agent_id": me["agent_id"], "operation_id": "test-reference-no-skipping"},
    ).json()
    assert (
        client.post(
            f"/api/transactions/{tx['id']}/submit", json={"version": tx["version"]}
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/transactions/{tx['id']}/liveness",
            json={"version": tx["version"], "scenario": "pass"},
        ).status_code
        == 422
    )
    repeated = client.post(
        "/api/transactions",
        json={"agent_id": me["agent_id"], "operation_id": "test-reference-no-skipping"},
    ).json()
    assert repeated["id"] == tx["id"]


def test_intake_draft_and_independent_review_without_payment(client, monkeypatch):
    from PIL import Image
    from uuid import uuid4
    from app.db import CaptureDraft, KycCapture

    login(client, "agent1")
    agent = client.get("/api/auth/me").json()["agent_id"]
    image = io.BytesIO()
    Image.new("RGB", (400, 200), "white").save(image, format="PNG")
    encoded = base64.b64encode(image.getvalue()).decode()
    intake = {
        "name": "Sample Customer",
        "document_number": "SAMPLE-ONLY",
        "nationality": "Sample",
        "birth_date": "1990-01-01",
        "expiry_date": "2090-12-31",
        "document_image": encoded,
        "sim_identifier": "SAMPLE-SIM",
        "plan_id": "sample-plan",
        "msisdn": "SAMPLE-PHONE",
        "signature": [[[i / 10, 0.5] for i in range(8)]],
    }
    intake["document_check"] = read_fixture_document(client, encoded)
    intake["plan_id"] = client.get("/api/resources/plans").json()[0]["id"]
    draft = client.get("/api/kyc-captures/draft").json()
    saved = client.put(
        "/api/kyc-captures/draft",
        json={"version": draft["version"], "data": intake},
    )
    assert saved.status_code == 200, saved.text
    assert (
        client.put(
            "/api/kyc-captures/draft",
            json={"version": draft["version"], "data": intake},
        ).status_code
        == 409
    )
    with DB() as db:
        assert all(
            "SAMPLE-ONLY" not in draft.payload_encrypted
            for draft in db.scalars(select(CaptureDraft))
        )
    body = {
        "agent_id": agent,
        "operation_id": str(uuid4()),
        "source_reference": "SAMPLE-PAYMENT",
        "image_base64": encoded,
        "intake": intake,
    }
    invalid = {**body, "intake": {**intake, "document_number": ""}}
    assert client.post("/api/kyc-captures", json=invalid).status_code == 422
    created = client.post("/api/kyc-captures", json=body)
    assert created.status_code == 201, created.text
    row = created.json()
    path = "/api/kyc-captures/" + row["id"]
    receipt = client.get(path + "/receipt")
    assert receipt.status_code == 200
    assert receipt.content.startswith(b"%PDF")
    from pypdf import PdfReader
    text = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(receipt.content)).pages)
    assert "FINAL REVIEW PENDING" in text
    assert "SAMPLE-SIM" in text
    assert "SAMPLE-ONLY" not in text
    assert client.get("/api/kyc-captures/missing-upload/receipt").status_code == 404
    assert client.post("/api/kyc-captures", json=body).json()["id"] == row["id"]
    assert client.get("/api/kyc-captures/draft").json()["data"] == {}
    assert (
        client.post(
            "/api/kyc-captures",
            json={**body, "intake": {**intake, "name": "Different customer"}},
        ).status_code
        == 422
    )
    with DB() as db:
        stored = db.get(KycCapture, row["id"])
        stored.status = "SUBMITTED"
        db.commit()
    login(client, "agent2")
    assert client.get("/api/kyc-captures/draft").json()["data"] == {}
    assert client.get(path).status_code == 404
    login(client, "compliance")
    review = {
        "version": row["version"],
        "outcome": "VERIFIED",
        "reason": "Checked kiosk reference and receipt",
    }
    verified = client.post(path + "/review", json=review)
    assert verified.status_code == 200, verified.text
    assert "payment_confirmed" not in verified.json()["review"]
    receipt = client.get(path + "/receipt")
    assert receipt.status_code == 200
    text = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(receipt.content)).pages)
    assert "RECEIPT VERIFIED" in text


def test_inventory_edit_is_scoped_audited_and_rejects_stale_details(client):
    login(client)
    sim = next(s for s in client.get("/api/resources/inventory").json()
               if s["status"] not in {"ACTIVATED", "RESERVED"})
    body = {"iccid": "QA-EDIT-" + sim["iccid"], "serial": sim["serial"],
            "sim_type": sim["sim_type"], "expected_iccid": sim["iccid"],
            "expected_serial": sim["serial"], "expected_type": sim["sim_type"],
            "reason": "Corrected inventory record"}
    path = "/api/inventory/" + sim["id"]
    edited = client.patch(path, json=body)
    assert edited.status_code == 200, edited.text
    assert edited.json()["iccid"] == body["iccid"]
    assert client.patch(path, json=body).status_code == 409
    with DB() as db:
        assert db.scalar(select(Audit).where(Audit.entity == sim["id"],
                                             Audit.action == "SIM Details Updated"))
    login(client, "agent1")
    assert client.patch(path, json=body).status_code == 403
    login(client)
    body.update(iccid=sim["iccid"], expected_iccid=edited.json()["iccid"])
    assert client.patch(path, json=body).status_code == 200


def test_identity_extraction_maps_printed_dates_without_verification_claim(client,monkeypatch):
    from app import captures
    login(client,"agent1")
    monkeypatch.setattr(captures.extractor,"extract",lambda _: {"lines":[{"text":"Identity document"},{"text":"Full legal name: Alex Sample"},{"text":"ID No: SAMPLE-001"},{"text":"Date of Birth: 14 NOV 1991"},{"text":"Date of expiry: 14/11/2030"}]})
    response=client.post("/api/kyc-captures/read-document",json={"image_base64":"eA=="})
    assert response.status_code==200
    result = response.json()
    assert result.pop("document_check", None)
    assert result=={"name":"Alex Sample","document_number":"SAMPLE-001","birth_date":"1991-11-14","expiry_date":"2030-11-14"}


def test_identity_extraction_reads_unseparated_document_labels(client, monkeypatch):
    from app import captures
    login(client, "agent1")
    monkeypatch.setattr(captures.extractor, "extract", lambda _: {"lines": [
        {"text": "Full Name ALEX SAMPLE"},
        {"text": "Identity number 784-1991-1234567-1"},
        {"text": "Nationality UNITED ARAB EMIRATES"},
        {"text": "Date of birth 14 NOV 1991"},
        {"text": "Expiry date 14 NOV 2030"},
    ]})
    response = client.post("/api/kyc-captures/read-document", json={"image_base64": "eA=="})
    assert response.status_code == 200
    result = response.json()
    assert result.pop("document_check", None)
    assert result == {
        "name": "ALEX SAMPLE", "document_number": "784-1991-1234567-1",
        "nationality": "UNITED ARAB EMIRATES", "birth_date": "1991-11-14",
        "expiry_date": "2030-11-14",
    }


def test_passport_mrz_autofills_readable_identity_without_verification(client, monkeypatch):
    from app import captures
    login(client, "agent1")
    monkeypatch.setattr(captures.extractor, "extract", lambda _: {"lines": [
        {"text": "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<"},
        {"text": "L898902C36UTO7408122F3004159<<<<<<<<<<<<<<04"},
    ]})
    response = client.post("/api/kyc-captures/read-document", json={"image_base64": "eA=="})
    assert response.status_code == 200
    result = response.json()
    assert result.pop("document_check", None)
    assert result == {
        "name": "ANNA MARIA ERIKSSON", "document_number": "L898902C3",
        "birth_date": "1974-08-12", "expiry_date": "2030-04-15",
    }


def test_admin_edit_delete_and_history_guards(client):
    login(client)
    made = client.post("/api/organization/branches", json={"name": "Admin control QA"})
    assert made.status_code == 201
    branch = made.json()
    change = {"values": {"name": "Admin control edited"}, "expected": {"name": branch["name"]}, "reason": "Corrected branch display name"}
    updated = client.patch("/api/administration/branches/" + branch["id"], json=change)
    assert updated.status_code == 200
    assert client.patch("/api/administration/branches/" + branch["id"], json=change).status_code == 409
    assert client.request("DELETE", "/api/administration/branches/" + branch["id"], json={"values": {}, "reason": "Removed unused QA branch"}).status_code == 200
    linked = client.get("/api/administration/branches").json()[0]
    assert client.request("DELETE", "/api/administration/branches/" + linked["id"], json={"values": {}, "reason": "Attempt protected deletion"}).status_code == 409
    login(client, "agent1")
    assert client.get("/api/administration/branches").status_code == 403
    assert client.patch("/api/administration/branches/" + linked["id"], json=change).status_code == 403


def test_admin_stock_customer_agent_controls(client):
    login(client)
    agent = client.get("/api/resources/agents").json()[0]
    customer = client.post("/api/administration/customers", json={"values": {"name": "Synthetic Admin Customer", "mobile": "SAMPLE-ADMIN", "agent_id": agent["id"]}, "reason": "Created synthetic customer record"})
    assert customer.status_code == 201
    assert client.request("DELETE", "/api/administration/customers/" + customer.json()["id"], json={"values": {}, "reason": "Removed unused synthetic customer"}).status_code == 200
    stock_values = {"iccid": "SAMPLE-ADMIN-ICCID", "serial": "SAMPLE-ADMIN-SERIAL", "sim_type": "Physical", "outlet_id": agent["outlet_id"], "agent_id": agent["id"]}
    stock = client.post("/api/administration/inventory", json={"values": stock_values, "reason": "Received synthetic stock delivery"})
    assert stock.status_code == 201, stock.text
    assert client.post("/api/administration/inventory", json={"values": stock_values, "reason": "Duplicate stock must be rejected"}).status_code == 409
    assert client.request("DELETE", "/api/administration/inventory/" + stock.json()["id"], json={"values": {}, "reason": "Cannot erase stock movement history"}).status_code == 409
    profile = next(a for a in client.get("/api/administration/agents").json() if a["id"] == agent["id"])
    body = {"values": {"name": "Admin Edited Agent", "email": profile["email"], "employee_id": profile["employee_id"], "target": profile["target"]}, "expected": {k: profile[k] for k in ["name", "email", "employee_id", "target"]}, "reason": "Corrected synthetic agent profile"}
    edited = client.patch("/api/administration/agents/" + agent["id"], json=body)
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "Admin Edited Agent"
    assert "password_hash" not in str(client.get("/api/administration/teams").json())
    body["values"]["name"] = profile["name"]
    body["expected"]["name"] = "Admin Edited Agent"
    assert client.patch("/api/administration/agents/" + agent["id"], json=body).status_code == 200


def test_admin_task_and_incentive_edits(client):
    login(client)
    agent = client.get("/api/resources/agents").json()[0]
    for kind, values, key, revised in [
        ("tasks", {"title": "Synthetic follow-up", "agent_id": agent["id"], "due_date": "2026-10-01"}, "title", "Updated follow-up"),
        ("incentives", {"period": "2026-09", "amount": "12.50", "agent_id": agent["id"]}, "amount", "15.00"),
    ]:
        made = client.post("/api/administration/" + kind, json={"values": values, "reason": "Added synthetic administration record"})
        assert made.status_code == 201, made.text
        row = made.json()
        changed = client.patch("/api/administration/" + kind + "/" + row["id"], json={"values": {key: revised}, "expected": {key: row[key]}, "reason": "Corrected synthetic administration record"})
        assert changed.status_code == 200, changed.text
        assert str(changed.json()[key]) == revised


def test_payment_invoice_review_and_backend_activation(client, monkeypatch):
    from uuid import uuid4
    from PIL import Image
    from app.db import KycCapture
    from app.captures import store
    from pypdf import PdfReader
    login(client, "agent1")
    agent = client.get("/api/resources/agents").json()[0]
    plan = client.get("/api/resources/plans").json()[0]
    image = io.BytesIO()
    Image.new("RGB", (200, 200), "white").save(image, format="PNG")
    encoded = base64.b64encode(image.getvalue()).decode()
    from app.db import Sim, Agent, Movement
    stock_serial = "PAY-QA-" + str(uuid4())[:12]
    with DB() as db:
        item = Sim(iccid=stock_serial, serial=stock_serial, sim_type="PHYSICAL", status="AVAILABLE", agent_id=agent["id"], outlet_id=db.get(Agent, agent["id"]).outlet_id)
        db.add(item)
        db.commit()
        stock_id = item.id
    intake = {"name":"Synthetic Payment Customer", "document_number":"SAMPLE-ID-9090", "nationality":"Synthetic", "birth_date":"1990-01-01", "expiry_date":"2090-12-31", "document_image":encoded, "sim_identifier":stock_serial, "plan_id":plan["id"], "msisdn":"SAMPLE-PHONE", "signature":[[[i/10,0.5] for i in range(8)]]}
    from app import captures
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(captures.extractor, "extract", lambda _: {"lines": [{"text":"Identity document"}] + [
            {"text": f"{label}: {intake[key]}"} for label, key in [
                ("Full name", "name"), ("Document number", "document_number"),
                ("Date of birth", "birth_date"), ("Expiry date", "expiry_date")]
        ]})
        intake["document_check"] = client.post("/api/kyc-captures/read-document",
            json={"image_base64": encoded}).json()["document_check"]
    intake['transaction_id'] = str(uuid4())
    scanned = client.post('/api/inventory/scan',json={'code':stock_serial,'transaction_id':intake['transaction_id']})
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()['stage'] == 'IN_PROGRESS'
    assert client.post('/api/inventory/scan',json={'code':stock_serial,'transaction_id':str(uuid4())}).status_code == 409
    assert next(s for s in client.get('/api/resources/inventory').json() if s['id']==stock_id)['status'] == 'AVAILABLE'
    body = {"document_kind":"PAYMENT_CONFIRMATION", "agent_id":agent["id"], "operation_id":str(uuid4()), "image_base64":encoded}
    assert client.post("/api/kyc-captures",json=body).status_code == 422
    body["intake"] = intake
    made = client.post("/api/kyc-captures",json=body)
    assert made.status_code == 201, made.text
    row = made.json()
    path = "/api/kyc-captures/" + row["id"]
    assert row["invoice"]["heading"] == "Payment successful"
    fields = {f["label"]:f["value"] for section in row["invoice"]["sections"] for f in section["fields"]}
    assert fields["Total paid"] == fields["Selfie"] == fields["Payment reference"] == "Not recorded"
    assert fields["Plan price"] == f"AED {plan['monthly_cost']:.2f}"
    assert fields["Document number"] == "**** 9090"
    assert client.post("/api/kyc-captures",json=body).json()["id"] == row["id"]
    login(client)
    action = {"version":row["version"],"outcome":"ACTIVATED","reference":"EXT-SAMPLE-99","reason":"Completed by carrier team"}
    assert client.post(path+"/activation",json=action).status_code == 409
    with DB() as db:
        item = db.get(KycCapture,row["id"])
        from app.captures import payload
        data = payload(item)
        data["lines"] = []
        data["rows"] = [{"fields":[{"label":"Total paid","value":"AED 350.00"}]}]
        store(item,data)
        item.status = "EXTRACTED"
        db.commit()
    login(client,"agent1")
    current = client.get(path).json()
    saved = client.patch(path+"/rows",json={"version":current["version"],"rows":current["rows"],"reason":"Checked payment confirmation"})
    assert saved.status_code == 200, saved.text
    submitted = client.post(path+"/submit",json={"version":saved.json()["version"]}).json()
    login(client,"compliance")
    verified = client.post(path+"/review",json={"version":submitted["version"],"outcome":"VERIFIED","reason":"Compared original and customer details"})
    assert verified.status_code == 200, verified.text
    login(client,'admin')
    state=next(s for s in client.get('/api/resources/inventory').json() if s['id']==stock_id)
    assert state['status']=='AVAILABLE' and state['activation_stage']=='READY_FOR_ACTIVATION' and state['payment_status']=='VERIFIED'
    assert any(stock_serial in n['message'] for n in client.get('/api/inventory/scan-notifications').json())
    login(client,'compliance')
    assert any(item["id"] == row["id"] for item in client.get("/api/kyc-captures?stage=READY").json())
    action["version"] = verified.json()["version"]
    assert client.post(path+"/activation",json=action).status_code == 403
    login(client,"agent1")
    assert client.post(path+"/activation",json=action).status_code == 403
    login(client,"ops")
    completed = client.post(path+"/activation",json=action)
    assert completed.status_code == 200, completed.text
    assert completed.json()["activation"]["status"] == "ACTIVATED"
    assert all(item["id"] != row["id"] for item in client.get("/api/kyc-captures?stage=READY").json())
    assert any(item["id"] == row["id"] for item in client.get("/api/kyc-captures?stage=COMPLETED").json())
    assert any(o["id"] == completed.json()["order_id"] and o["status"] == "ACTIVATED" for o in client.get("/api/resources/activations").json())
    action["version"] = completed.json()["version"]
    assert client.post(path+"/activation",json=action).status_code == 409
    pdf = client.get(path+"/receipt")
    text = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.content)).pages)
    assert "PAYMENT INVOICE" in text and "Not recorded" in text and "350.00" in text
    assert "SAMPLE-ID-9090" not in text
    with DB() as db:
        assert db.scalar(select(Order).where(Order.id == completed.json()["order_id"])).status == "ACTIVATED"
    with DB() as db:
        assert db.get(Sim, stock_id).status == "ACTIVATED"
        assert db.scalar(select(Movement).where(Movement.sim_id == stock_id)).new_status == "ACTIVATED"


def test_document_readability_proof_rejects_manual_fields_and_image_swaps(client, monkeypatch):
    from app import captures
    from PIL import Image
    login(client, "agent1")
    image = io.BytesIO()
    Image.new("RGB", (400, 200), "white").save(image, format="PNG")
    encoded = base64.b64encode(image.getvalue()).decode()
    monkeypatch.setattr(captures.extractor, "extract", lambda _: {"lines": [{"text":"A random holiday photograph"}]})
    unreadable = client.post("/api/kyc-captures/read-document", json={"image_base64":encoded})
    assert "document_check" not in unreadable.json()
    intake = {"step":1, "name":"Avery Stone", "document_number":"SAMPLE-ID-1001",
        "birth_date":"1990-01-01", "expiry_date":"2030-12-31", "document_image":encoded}
    version = client.get("/api/kyc-captures/draft").json()["version"]
    def save(data):
        return client.put("/api/kyc-captures/draft",json={"version":version,"data":data})
    assert save(intake).status_code == 422
    monkeypatch.setattr(captures.extractor, "extract", lambda _: {"lines":[
        {"text":"Identity document"}, {"text": "Full name: Avery Stone"}, {"text":"Document number: SAMPLE-ID-1001"},
        {"text":"Date of birth: 1990-01-01"}, {"text":"Expiry date: 2030-12-31"}]})
    fields=client.post("/api/kyc-captures/read-document",json={"image_base64":encoded}).json()
    intake.update(fields)
    assert save({**intake,"document_number":"OTHER-ID"}).status_code == 422
    other=io.BytesIO()
    Image.new("RGB",(400,200),"red").save(other,format="PNG")
    assert save({**intake,"document_image":base64.b64encode(other.getvalue()).decode()}).status_code == 422
    assert save({**intake,"document_check":"preview-only-document"}).status_code == 422
    import json
    expired=json.loads(captures.cipher.decrypt(intake["document_check"].encode()))
    expired["expires"]=0
    expired_check=captures.cipher.encrypt(json.dumps(expired).encode()).decode()
    assert save({**intake,"document_check":expired_check}).status_code == 422
    login(client,"agent2")
    other_version=client.get("/api/kyc-captures/draft").json()["version"]
    assert client.put("/api/kyc-captures/draft",json={"version":other_version,"data":intake}).status_code == 422
    login(client,"agent1")
    assert save(intake).status_code == 200


def test_saved_drafts_are_explicit_private_and_can_be_discarded(client):
    from uuid import uuid4
    login(client,'agent1')
    body={'data':{'name':'Saved Sample','transaction_id':str(uuid4())}}
    saved=client.post('/api/kyc-captures/saved-drafts',json=body)
    assert saved.status_code==201, saved.text
    identifier=saved.json()['id']
    assert any(r['id']==identifier for r in client.get('/api/kyc-captures/saved-drafts').json())
    login(client,'agent2')
    assert all(r['id']!=identifier for r in client.get('/api/kyc-captures/saved-drafts').json())
    assert client.delete('/api/kyc-captures/saved-drafts/'+identifier).status_code==404
    login(client,'agent1')
    assert client.delete('/api/kyc-captures/saved-drafts/'+identifier).status_code==200
    assert all(r['id']!=identifier for r in client.get('/api/kyc-captures/saved-drafts').json())


def test_sim_pack_parsing_and_claims_are_scoped(client):
    from uuid import uuid4
    login(client,'admin')
    parsed=client.post('/api/inventory/parse-pack',json={'code':'{"ICCID":"8997102007719330280","SIM Serial":"PACK-001","Type":"eSIM"}'})
    assert parsed.status_code==200 and parsed.json()=={'iccid':'8997102007719330280','serial':'PACK-001','sim_type':'eSIM'}
    assert client.post('/api/inventory/parse-pack',json={'code':'not a sim qr'}).status_code==422
    stock=next(s for s in client.get('/api/resources/inventory').json() if s['agent_id'] and s['status']=='AVAILABLE')
    agent_id=stock['agent_id']
    tx=str(uuid4())
    claim=client.post('/api/inventory/scan',json={'code':stock['iccid'],'agent_id':agent_id,'transaction_id':tx})
    assert claim.status_code==200, claim.text
    assert client.post('/api/inventory/scan',json={'code':stock['iccid'],'agent_id':agent_id,'transaction_id':tx}).status_code==200
    notification = client.get('/api/inventory/scan-notifications').json()[0]
    assert notification['sim_id'] == stock['id']
    login(client,'agent2')
    if client.get('/api/auth/me').json()['agent_id'] != agent_id:
        assert client.post('/api/inventory/scan',json={'code':stock['iccid'],'agent_id':agent_id,'transaction_id':tx}).status_code==404
        assert client.delete('/api/inventory/scan/'+tx).status_code==404
    login(client,'admin')
    assert client.delete('/api/inventory/scan/'+tx).status_code==200


def test_customer_order_screen_capture_requires_evidence_and_preserves_amounts(client, monkeypatch):
    from app import captures
    from PIL import Image

    login(client, "agent1")
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode()
    monkeypatch.setattr(
        captures.extractor,
        "extract",
        lambda _: {
            "lines": [
                {"text": t}
                for t in [
                    "Customer Details",
                    "AVERY STONE",
                    "Document Type: UAE Identity card",
                    "Document Number: SAMPLE-ID-1001",
                    "Nationality: United Arab Emirates",
                    "Date of Birth: 01-Jan-1990",
                    "Expiry Date: 31-Dec-2030",
                ]
            ]
        },
    )
    identity = client.post("/api/kyc-captures/read-document", json={"image_base64": encoded}).json()
    assert identity["name"] == "AVERY STONE"
    assert identity["birth_date"] == "1990-01-01"
    assert identity.get("document_check")
    monkeypatch.setattr(
        captures.extractor,
        "extract",
        lambda _: {
            "lines": [
                {"text": t}
                for t in [
                    "Order Details",
                    "Product Name",
                    "5G Unlimited Ultra",
                    "Package Name",
                    "5G Unlimited Ultra",
                    "MSISDN",
                    "0500000000",
                    "Request Id",
                    "SAMPLE-REQ-1001",
                    "AED 350 Monthly - AED 0 Prepayment",
                ]
            ]
        },
    )
    order = client.post("/api/kyc-captures/read-order", json={"image_base64": encoded}).json()
    assert order["order_reference"] == "SAMPLE-REQ-1001"
    assert order["monthly_cost"] == "350" and order["prepayment"] == "0"
    assert order.get("order_check") and order.get("plan_id")
    intake = {
        **identity,
        **order,
        "capture_mode": "SCREENSHOT_ORDER",
        "document_image": encoded,
        "order_image": encoded,
        "step": 2,
    }
    version = client.get("/api/kyc-captures/draft").json()["version"]
    assert (
        client.put(
            "/api/kyc-captures/draft",
            json={"version": version, "data": {**intake, "order_reference": "OTHER"}},
        ).status_code
        == 422
    )
    assert (
        client.put("/api/kyc-captures/draft", json={"version": version, "data": intake}).status_code
        == 200
    )
    captures.Intake.model_validate(intake).complete()
    monkeypatch.setattr(
        captures.extractor, "extract", lambda _: {"lines": [{"text": "Random landscape"}]}
    )
    assert (
        not client.post("/api/kyc-captures/read-order", json={"image_base64": encoded})
        .json()
        .get("order_check")
    )


def test_backend_confirmation_notifies_scoped_read_only_leader(client):
    from app import captures
    from app.db import KycCapture, Notification, User
    from uuid import uuid4

    login(client, "admin")
    directory = client.get("/api/organization").json()
    leader = next(r for r in directory["leaders"] if r["branch_id"])
    assigned = client.put(
        f"/api/organization/branches/{leader['branch_id']}/leader", json={"leader_id": leader["id"]}
    )
    assert assigned.status_code == 200
    with DB() as db:
        agent = db.scalar(select(Agent).where(Agent.leader_id == leader["id"]))
        record = KycCapture(
            id=str(uuid4()),
            agent_id=agent.id,
            creator_id=agent.user_id,
            operation_id=str(uuid4()),
            source_reference="SAMPLE-LEADER-HANDOFF",
            image_hash="test",
            image_type="image/png",
            image_encrypted=captures.cipher.encrypt(b"test").decode(),
            status="SUBMITTED",
            version=1,
        )
        captures.store(record, {"rows": [], "history": []})
        db.add(record)
        db.commit()
        identifier = record.id
        email = db.get(User, leader["id"]).email
    r = client.post(
        f"/api/kyc-captures/{identifier}/review",
        json={"version": 1, "outcome": "VERIFIED", "reason": "Evidence reviewed"},
    )
    assert r.status_code == 200, r.text
    with DB() as db:
        assert db.scalar(
            select(Notification).where(
                Notification.user_id == leader["id"],
                Notification.message.like("%SAMPLE-LEADER-HANDOFF%"),
            )
        )
    login(client, "agent1")
    assert client.get("/api/kyc-captures/leader-confirmations").status_code == 403
    other = next((r for r in directory["leaders"] if r["id"] != leader["id"]), None)
    if other:
        with DB() as db:
            other_email = db.get(User, other["id"]).email
        login(client, other_email.split("@")[0])
        assert client.get(f"/api/kyc-captures/{identifier}").status_code == 404
        assert client.post(f"/api/kyc-captures/{identifier}/leader-confirm", json={"version": r.json()["version"], "note": "Other branch"}).status_code == 404
    login(client, email.split("@")[0])
    rows = client.get("/api/kyc-captures/leader-confirmations").json()
    row = next(r for r in rows if r["id"] == identifier)
    assert row["status"] == "VERIFIED"
    assert client.post(
        f"/api/kyc-captures/{identifier}/leader-confirm",
        json={"version": row["version"], "note": "Attempted branch confirmation"},
    ).status_code == 403
    assert client.post(
        f"/api/kyc-captures/{identifier}/review",
        json={"version": row["version"], "outcome": "VERIFIED", "reason": "Leader cannot verify"},
    ).status_code == 403
    with DB() as db:
        db.delete(db.get(KycCapture, identifier))
        db.commit()


def test_order_payment_record_has_no_inferred_payment_values():
    from types import SimpleNamespace
    from datetime import datetime, timezone
    from app.invoices import invoice

    row = SimpleNamespace(
        id="order-record", status="SUBMITTED", created_at=datetime.now(timezone.utc)
    )
    data = {
        "intake": {"capture_mode": "SCREENSHOT_ORDER", "order_reference": "SAMPLE-REQ-1001"},
        "rows": [],
    }
    result = invoice(row, data)
    assert result["heading"] == "Payment recorded"
    assert result["status"] == "Pending backend confirmation"
    assert "Customer signature" not in {field["label"] for section in result["sections"] for field in section["fields"]}
    payment = next(section for section in result["sections"] if section["title"] == "Payment")
    assert {field["label"] for field in payment["fields"]} == {
        "Request ID",
        "Agent payment record",
        "Backend confirmation",
    }
    row.status = "VERIFIED"
    assert invoice(row, data)["status"] == "Verified"
    legacy = invoice(row, {"intake": {}, "rows": []})
    assert legacy["heading"] == "Payment successful"
    assert "Customer signature" in {field["label"] for section in legacy["sections"] for field in section["fields"]}


def test_sales_management_scope_targets_and_status_file(client):
    from app.db import SalesRecord, CallAttempt, SalesCallTask
    from sqlalchemy import delete

    login(client, "admin")
    agents = client.get("/api/resources/agents").json()
    first = next(row for row in agents if row["employee_id"] == "RLY-1041")
    other_branch = next(row for row in agents if row["employee_id"] == "RLY-1044")
    body = {"agent_id": first["id"], "order_type": "NEW", "customer_name": "Sample Sales Customer",
            "plan_name": "Sample plan", "request_id": "SALES-TEST-REQ-1"}
    created = client.post("/api/sales-management/sales", json=body)
    assert created.status_code == 201, created.text
    sale_id = created.json()["id"]
    assert created.json()["document"] == "Not recorded"
    assert client.patch(f"/api/sales-management/sales/{sale_id}", json={"order_type":"HW", "router_serial":"", "reason":"Correct product"}).status_code == 422
    corrected = client.patch(f"/api/sales-management/sales/{sale_id}", json={"order_type":"HW", "router_serial":"ROUTER-123", "reason":"Confirmed product from order screen"})
    assert corrected.status_code == 200 and corrected.json()["router_serial"] == "ROUTER-123"
    assert client.post("/api/sales-management/sales", json=body).status_code == 409
    assert client.post("/api/sales-management/sales", json={**body, "order_type": "HW", "request_id": "SALES-TEST-REQ-2"}).status_code == 422
    feedback = client.post("/api/sales-management/feedback", json={"agent_id": first["id"],
        "product_suggested": "Sample plan", "feedback": "Customer asked for a later call",
        "rejection_reason": "Timing"})
    assert feedback.status_code == 201, feedback.text
    assert client.put("/api/sales-management/targets", json={"agent_id": first["id"],
        "period": "2026-09", "order_type": "ALL", "daily_target": 2, "monthly_target": 20}).status_code == 200

    login(client, "agent1")
    assert sale_id in {r["id"] for r in client.get("/api/sales-management/sales").json()}
    assert client.patch(f"/api/sales-management/sales/{sale_id}", json={"order_type":"NEW", "router_serial":"", "reason":"Agent change"}).status_code == 403
    assert client.post("/api/sales-management/sales", json={**body, "agent_id": other_branch["id"], "request_id": "SALES-TEST-REQ-3"}).status_code == 404
    assert client.post(f"/api/sales-management/sales/{sale_id}/calls", json={"stage":"WELCOME_CALL","outcome":"PASSED","remark":"Reached customer"}).status_code == 403
    assert client.post("/api/sales-management/status-file", json={"filename":"sales.csv","content_base64":"","apply":False}).status_code == 403
    login(client, "leader2")
    assert sale_id not in {r["id"] for r in client.get("/api/sales-management/sales").json()}
    login(client, "leader")
    assert sale_id in {r["id"] for r in client.get("/api/sales-management/sales").json()}
    assert client.put("/api/sales-management/targets", json={"agent_id": other_branch["id"],
        "period": "2026-09", "order_type": "ALL", "daily_target": 2, "monthly_target": 20}).status_code == 404
    login(client, "compliance")
    attempt = client.post(f"/api/sales-management/sales/{sale_id}/calls", json={"stage":"TELE_VERIFICATION","outcome":"NO_ANSWER","remark":"Call not answered"})
    assert attempt.status_code == 201, attempt.text
    assert client.get("/api/sales-management/calls").json()[0]["tele_verification"]

    login(client, "admin")
    exported = client.get("/api/sales-management/export")
    assert exported.status_code == 200 and "sale_id,current_status,new_status" in exported.text
    csv_content = f"sale_id,current_status,new_status,created_at\n{sale_id},IN_PROGRESS,CLOSED,ignored\n"
    payload = {"filename":"sales.csv", "content_base64":base64.b64encode(csv_content.encode()).decode()}
    preview = client.post("/api/sales-management/status-file", json={**payload,"apply":False})
    assert preview.status_code == 200 and len(preview.json()["changes"]) == 1
    assert client.post("/api/sales-management/status-file", json={**payload,"apply":True}).json()["applied"]
    assert client.get("/api/sales-management/performance?period=2026-09").status_code == 200
    assert client.post("/api/sales-management/status-file", json={**payload,"apply":True}).status_code == 422
    with DB() as db:
        db.execute(delete(CallAttempt).where(CallAttempt.sale_id == sale_id))
        db.execute(delete(SalesCallTask).where(SalesCallTask.sale_id == sale_id))
        db.delete(db.get(SalesRecord, sale_id))
        db.commit()


def test_field_assets_track_assignment_requests_and_scope(client):
    from app.db import FieldAsset, FieldAssetMovement, FieldAssetRequest, StockThreshold
    from sqlalchemy import delete
    login(client, "admin")
    branches = client.get("/api/resources/branches").json()
    agents = client.get("/api/resources/agents").json()
    first = next(row for row in agents if row["employee_id"] == "RLY-1041")
    other = next(row for row in agents if row["employee_id"] == "RLY-1044")
    first_branch = next(row for row in branches if row["name"] == "Dubai Central")
    body = {"category": "GRABBA_DEVICE", "label": "Test reader", "serial": "TEST-GRABBA-1",
            "quantity": 1, "branch_id": first_branch["id"]}
    created = client.post("/api/field-assets", json=body)
    assert created.status_code == 201, created.text
    asset_id = created.json()["id"]
    assert client.post("/api/field-assets", json=body).status_code == 409
    assert client.post("/api/field-assets", json={**body,"serial":"TEST-GRABBA-2","quantity":2}).status_code == 422
    assert client.patch(f"/api/field-assets/{asset_id}", json={"branch_id":first_branch["id"],
        "agent_id":other["id"],"status":"ASSIGNED","reason":"Incorrect branch"}).status_code == 422
    moved = client.patch(f"/api/field-assets/{asset_id}", json={"branch_id":first_branch["id"],
        "agent_id":first["id"],"status":"ASSIGNED","reason":"Issue to agent"})
    assert moved.status_code == 200 and moved.json()["agent_id"] == first["id"]
    assert len(client.get(f"/api/field-assets/{asset_id}/history").json()) == 2
    login(client, "agent1")
    assert asset_id in {r["id"] for r in client.get("/api/field-assets").json()}
    assert client.patch(f"/api/field-assets/{asset_id}", json={"branch_id":first_branch["id"],
        "status":"RETURNED","reason":"Return item"}).status_code == 403
    requested = client.post("/api/field-assets/requests", json={"agent_id":first["id"],
        "category":"UNIFORM","quantity":1,"urgency":"URGENT","reason":"Replacement needed"})
    assert requested.status_code == 201, requested.text
    request_id = requested.json()["id"]
    login(client, "leader2")
    assert asset_id not in {r["id"] for r in client.get("/api/field-assets").json()}
    assert request_id not in {r["id"] for r in client.get("/api/field-assets/requests/list").json()}
    login(client, "admin")
    assert any(row["urgency"] == "URGENT" for row in client.get("/api/field-assets/requests/list").json())
    threshold = client.put("/api/field-assets/report/threshold", json={"branch_id": first_branch["id"],
        "category": "UNIFORM", "minimum": 99})
    assert threshold.status_code == 200
    assert any(row["category"] == "UNIFORM" and row["low_stock"] for row in client.get("/api/field-assets/report/summary").json())
    assert client.get("/api/field-assets/report/export?kind=summary").status_code == 200
    assert client.get("/api/field-assets/report/export?kind=movements").status_code == 200
    assert client.patch(f"/api/field-assets/requests/{request_id}", json={"status":"FULFILLED","reason":"No approval"}).status_code == 409
    assert client.patch(f"/api/field-assets/requests/{request_id}", json={"status":"APPROVED","reason":"Stock approved"}).status_code == 200
    assert client.patch(f"/api/field-assets/requests/{request_id}", json={"status":"FULFILLED","reason":"Issued item"}).status_code == 422
    uniform = client.post("/api/field-assets", json={"category":"UNIFORM","label":"Test uniform", "quantity":1,"branch_id":first_branch["id"]})
    uniform_id = uniform.json()["id"]
    assert client.patch(f"/api/field-assets/{uniform_id}", json={"branch_id":first_branch["id"],
        "agent_id":first["id"],"status":"ASSIGNED","reason":"Issue uniform"}).status_code == 200
    assert client.patch(f"/api/field-assets/requests/{request_id}", json={"status":"FULFILLED","reason":"Issued item","asset_id":uniform_id}).status_code == 200
    with DB() as db:
        db.execute(delete(StockThreshold).where(StockThreshold.id == threshold.json()["id"]))
        db.execute(delete(FieldAssetRequest).where(FieldAssetRequest.id == request_id))
        db.execute(delete(FieldAssetMovement).where(FieldAssetMovement.asset_id == asset_id))
        db.execute(delete(FieldAssetMovement).where(FieldAssetMovement.asset_id == uniform_id))
        db.delete(db.get(FieldAsset, asset_id))
        db.delete(db.get(FieldAsset, uniform_id))
        db.commit()


def test_call_tasks_roles_and_sequential_release(client):
    from app.db import SalesRecord, SalesCallTask, CallAttempt, User
    from sqlalchemy import delete
    login(client, "admin")
    agents = client.get("/api/resources/agents").json()
    first = next(row for row in agents if row["employee_id"] == "RLY-1041")
    other = next(row for row in agents if row["employee_id"] == "RLY-1044")
    sale = client.post("/api/sales-management/sales", json={"agent_id":first["id"],
        "order_type":"NEW", "customer_name":"Call Queue Sample", "plan_name":"Sample plan",
        "request_id":"SAMPLE-CALL-QUEUE-001"})
    assert sale.status_code == 201, sale.text
    sale_id = sale.json()["id"]
    assert {task["status"] for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == sale_id} == {"PENDING", "BLOCKED"}
    staff = client.get("/api/sales-management/staff")
    assert staff.status_code == 200 and any(row["role"] == "Sales Manager" for row in staff.json())
    assert client.post("/api/sales-management/staff", json={"name":"New Sales Manager", "email":"new.manager@relay.demo",
        "password":"strong-test-password", "role":"Sales Manager"}).status_code == 422
    branch = next(row["id"] for row in client.get("/api/resources/branches").json() if row["name"] == "Dubai Central")
    created_staff = client.post("/api/sales-management/staff", json={"name":"New Sales Manager", "email":"new.manager@relay.demo",
        "password":"strong-test-password", "role":"Sales Manager", "branch_id":branch})
    assert created_staff.status_code == 201
    login(client, "salesmanager")
    assert sale_id in {row["id"] for row in client.get("/api/sales-management/sales").json()}
    assert client.post("/api/sales-management/sales", json={"agent_id":other["id"],"order_type":"NEW",
        "customer_name":"Wrong branch", "plan_name":"Sample plan"}).status_code == 403
    login(client, "welcome")
    assert client.get("/api/resources/agents").status_code == 403
    assert client.get("/api/sales-management/targets").status_code == 403
    assert client.post("/api/sales-management/sales", json={"agent_id":first["id"],"order_type":"NEW","customer_name":"Unauthorized", "plan_name":"Plan"}).status_code == 403
    assert all(task["stage"] == "WELCOME_CALL" for task in client.get("/api/sales-management/call-tasks").json())
    assert client.post(f"/api/sales-management/sales/{sale_id}/calls", json={"stage":"WELCOME_CALL",
        "outcome":"REACHED", "remark":"Welcome customer"}).status_code == 409
    login(client, "tele")
    assert all(task["stage"] == "TELE_VERIFICATION" for task in client.get("/api/sales-management/call-tasks").json())
    assert client.post(f"/api/sales-management/sales/{sale_id}/calls", json={"stage":"WELCOME_CALL",
        "outcome":"REACHED", "remark":"Wrong team"}).status_code == 403
    passed = client.post(f"/api/sales-management/sales/{sale_id}/calls", json={"stage":"TELE_VERIFICATION",
        "outcome":"PASSED", "remark":"Identity confirmed"})
    assert passed.status_code == 201, passed.text
    login(client, "welcome")
    ready = [task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == sale_id]
    assert ready[0]["status"] == "PENDING"
    assert client.post(f"/api/sales-management/sales/{sale_id}/calls", json={"stage":"WELCOME_CALL",
        "outcome":"REACHED", "remark":"Customer welcomed"}).status_code == 201
    assert [task for task in client.get("/api/sales-management/call-tasks").json() if task["sale_id"] == sale_id][0]["status"] == "COMPLETED"
    with DB() as db:
        db.execute(delete(CallAttempt).where(CallAttempt.sale_id == sale_id))
        db.execute(delete(SalesCallTask).where(SalesCallTask.sale_id == sale_id))
        db.delete(db.get(SalesRecord, sale_id))
        db.delete(db.get(User, created_staff.json()["id"]))
        db.commit()


def test_bulk_stock_reports_and_return_checklist(client):
    from app.db import FieldAsset, FieldAssetMovement
    from sqlalchemy import delete
    from openpyxl import load_workbook
    login(client)
    agents = client.get("/api/resources/agents").json()
    agent = next(row for row in agents if row["employee_id"] == "RLY-1041")
    asset = client.post("/api/field-assets", json={"category":"CUSTOM_SUPPLY", "label":"Uniform batch", "quantity":10,
        "branch_id":agent["branch_id"], "warehouse":"Central store", "batch":"B-1", "size":"M", "condition":"New"})
    assert asset.status_code == 201, asset.text
    stock_id = asset.json()["id"]
    issued = client.post(f"/api/field-assets/{stock_id}/issue", json={"quantity":3,"agent_id":agent["id"],"reason":"Issue branch supplies"})
    assert issued.status_code == 201, issued.text
    issued_id = issued.json()["id"]
    assert issued.json()["quantity"] == 3 and issued.json()["batch"] == "B-1"
    assert client.post(f"/api/field-assets/{stock_id}/issue", json={"quantity":8,"agent_id":agent["id"],"reason":"Excess allocation"}).status_code == 409
    assert client.post(f"/api/field-assets/{stock_id}/adjust", json={"delta":-8,"reason":"Negative balance"}).status_code == 422
    rows = client.get("/api/field-assets/report/summary").json()
    row = next(row for row in rows if row["category"] == "CUSTOM_SUPPLY")
    assert row["available"] == 7 and row["assigned"] == 3
    export = client.get("/api/field-assets/report/export?kind=stock&format=xlsx&category=CUSTOM_SUPPLY")
    workbook = load_workbook(io.BytesIO(export.content))
    assert workbook.active.max_row == 3
    check = client.get(f"/api/field-assets/report/checklist?agent_id={agent['id']}")
    assert not check.json()["clear"] and issued_id in {row["id"] for row in check.json()["outstanding"]}
    login(client,"leader2")
    assert client.get(f"/api/field-assets/report/checklist?agent_id={agent['id']}").status_code == 404
    assert client.get(f"/api/field-assets/report/movements?branch_id={agent['branch_id']}").json() == []
    login(client)
    returned = client.patch(f"/api/field-assets/{issued_id}", json={"branch_id":agent["branch_id"],"status":"RETURNED","condition":"Good","reason":"Returned before transfer"})
    assert returned.status_code == 200 and returned.json()["agent_id"] is None
    with DB() as db:
        db.execute(delete(FieldAssetMovement).where(FieldAssetMovement.asset_id.in_([stock_id,issued_id])))
        db.execute(delete(FieldAsset).where(FieldAsset.id.in_([stock_id,issued_id])))
        db.commit()


def test_agent_transfer_moves_stock_and_exit_requires_returns(client):
    from app.db import User, Role, Agent, Branch, Outlet, Sim, FieldAsset, FieldAssetMovement, Movement, Session, Audit
    from app.security import password_hash
    from sqlalchemy import delete
    with DB() as db:
        origin_branch = db.scalar(select(Branch).where(Branch.name == "Abu Dhabi Region"))
        origin = db.scalar(select(Outlet).where(Outlet.branch_id == origin_branch.id))
        target = db.scalar(select(Branch.id).where(Branch.name == "Dubai Central"))
        role_id = db.scalar(select(Role.id).where(Role.name == "Field Agent"))
        person = User(name="Transfer Test", email="transfer-test@relay.demo", password_hash=password_hash("test-client-password"), role_id=role_id, branch_id=origin.branch_id)
        db.add(person)
        db.flush()
        agent = Agent(user_id=person.id, employee_id="TRANSFER-TEST", outlet_id=origin.id, lat=0, lng=0)
        db.add(agent)
        db.flush()
        sim = Sim(serial="TRANSFER-SIM", iccid="TRANSFER-ICCID", sim_type="Physical", outlet_id=origin.id, agent_id=agent.id)
        asset = FieldAsset(category="ROUTER", label="Transfer router", serial="TRANSFER-ROUTER", quantity=1, status="ASSIGNED", branch_id=origin.branch_id, agent_id=agent.id)
        db.add_all([sim,asset])
        db.commit()
        agent_id, asset_id, sim_id, user_id = agent.id,asset.id,sim.id,person.id
    login(client)
    assert client.post(f"/api/field-assets/agents/{agent_id}/exit", json={"reason":"Employee leaving"}).status_code == 409
    moved = client.post(f"/api/field-assets/agents/{agent_id}/transfer", json={"branch_id":target,"stock_action":"TRANSFER","reason":"New branch assignment"})
    assert moved.status_code == 200, moved.text
    with DB() as db:
        assert db.get(FieldAsset,asset_id).branch_id == target
        assert db.get(Outlet,db.get(Sim,sim_id).outlet_id).branch_id == target
        assert db.get(User,user_id).branch_id == target
        assert db.get(Agent,agent_id).leader_id
    assert client.patch(f"/api/field-assets/{asset_id}",json={"branch_id":target,"status":"RETURNED","reason":"Return before exit"}).status_code == 200
    with DB() as db:
        db.get(Sim,sim_id).agent_id = None
        db.commit()
    assert client.post(f"/api/field-assets/agents/{agent_id}/exit",json={"reason":"Exit checklist complete"}).status_code == 200
    denied=client.post("/api/auth/login",json={"email":"transfer-test@relay.demo","password":"test-client-password"})
    assert denied.status_code == 403
    with DB() as db:
        db.execute(delete(FieldAssetMovement).where(FieldAssetMovement.asset_id==asset_id))
        db.execute(delete(Movement).where(Movement.sim_id==sim_id))
        db.execute(delete(FieldAsset).where(FieldAsset.id==asset_id))
        db.execute(delete(Sim).where(Sim.id==sim_id))
        db.execute(delete(Audit).where(Audit.agent_id==agent_id))
        db.execute(delete(Session).where(Session.user_id==user_id))
        db.delete(db.get(Agent,agent_id))
        db.flush()
        db.delete(db.get(User,user_id))
        db.commit()


def test_backend_staff_provisioning_does_not_grant_admin_deletion(client):
    login(client, "ops")
    directory = client.get("/api/organization")
    assert directory.status_code == 200
    added = client.post("/api/organization/branches", json={"name": "Backend managed branch"})
    assert added.status_code == 201
    branch_id = added.json()["id"]
    assert client.get("/api/administration/branches").status_code == 200
    assert client.request("DELETE", f"/api/administration/branches/{branch_id}", json={"values":{},"reason":"Remove empty branch"}).status_code == 403
    assert client.get("/api/sales-management/staff").status_code == 200
    login(client, "agent1")
    assert client.get("/api/sales-management/staff").status_code == 403


def test_stock_request_response_is_visible_only_to_assigned_scope(client):
    login(client, "agent1")
    agent_id = client.get("/api/auth/me").json()["agent_id"]
    added = client.post("/api/field-assets/requests", json={"agent_id":agent_id,"category":"UNIFORM","quantity":1,"reason":"Replacement required"})
    assert added.status_code == 201
    request_id = added.json()["id"]
    login(client)
    assert client.patch(f"/api/field-assets/requests/{request_id}", json={"status":"APPROVED","reason":"Collect your replacement tomorrow"}).status_code == 200
    login(client, "agent1")
    row = next(row for row in client.get("/api/field-assets/requests/list").json() if row["id"] == request_id)
    assert row["response"] == "Collect your replacement tomorrow"
    assert row["responded_by"]
    login(client, "leader2")
    assert request_id not in {row["id"] for row in client.get("/api/field-assets/requests/list").json()}


def test_target_change_keeps_designated_branch_leader(client):
    login(client)
    agent = next(row for row in client.get("/api/resources/agents").json() if row["employee_id"] == "RLY-1041")
    response = client.patch(f"/api/agents/{agent['id']}/management", json={"target":agent["target"]+1, "outlet_id":agent["outlet_id"], "leader_id":None, "expected_target":agent["target"], "expected_outlet_id":agent["outlet_id"], "expected_leader_id":agent["leader_id"], "reason":"Change target without changing supervisor"})
    assert response.status_code == 200, response.text
    assert response.json()["leader_id"] == agent["leader_id"]


def test_sales_date_filters_use_business_dates_and_export_same_records(client):
    from datetime import datetime
    from app.db import SalesRecord
    login(client)
    agent = next(row for row in client.get('/api/resources/agents').json() if row['employee_id']=='RLY-1041')
    ids=[]
    for day in [31, 30]:
        row=client.post('/api/sales-management/sales',json={'agent_id':agent['id'],'order_type':'NEW','customer_name':'Date boundary check','plan_name':'Plan'}).json()
        ids.append(row['id'])
        with DB() as db:
            db.get(SalesRecord,row['id']).created_at=datetime(2033,1,day,22)
            db.commit()
    response=client.get('/api/sales-management/sales?period=2033-01&from_date=2033-01-31&to_date=2033-01-31')
    assert response.status_code==200 and [row['id'] for row in response.json()]==[ids[1]]
    export=client.get('/api/sales-management/export?period=2033-01&from_date=2033-01-31&to_date=2033-01-31')
    assert ids[1] in export.text and ids[0] not in export.text
    assert client.get('/api/sales-management/sales?from_date=2033-02-31').status_code==422
    assert client.get('/api/sales-management/sales?from_date=2033-02-01&to_date=2033-01-01').status_code==422


def test_order_reference_recovers_split_digits_but_never_invents_words():
    from app.captures import order_fields
    assert order_fields([{'text': 'Request Id: SAMPLE-REQ-1790755791 762000'}])['order_reference'] == 'SAMPLE-REQ-1790755791762000'
    assert order_fields([{'text': 'Request Id: 1570837 383'}])['order_reference'] == '1570837383'
    assert 'order_reference' not in order_fields([{'text': 'Request Id: order created successfully'}])
    assert 'order_reference' not in order_fields([{'text': 'Order Details'}])

@pytest.mark.parametrize('account',['admin','ops','agent1','leader','leader2','salesmanager','compliance','tele','welcome','inventory'])
def test_notification_inbox_roles_and_safe_paths(client, account):
    login(client, account)
    response = client.get('/api/notifications')
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['unread'] == sum(not row['read'] for row in result['items'])
    assert len({row['id'] for row in result['items']}) == len(result['items'])
    for row in result['items']:
        assert row['web_path'].startswith('/') and row['mobile_path'].startswith('/')
        assert 'document_number' not in row and 'image' not in row
        if account in {'tele','welcome'}:
            assert row['category'] in {'Calls','Workspace'}
        if account.startswith('leader') and row['category']=='Transactions':
            assert row['title'] == 'Confirmed by backend'


def test_notification_read_scope_persistence_and_no_business_mutation(client):
    from app.db import Notification, User, NotificationRead
    with DB() as db:
        agent = db.scalar(select(User).where(User.email=='agent1@relay.demo'))
        other = db.scalar(select(User).where(User.email=='leader2@relay.demo'))
        notice = Notification(user_id=agent.id,message='Your workspace update')
        foreign = Notification(user_id=other.id,message='Other account only')
        db.add_all([notice,foreign])
        db.commit()
        key,foreign_key = f'notice:{notice.id}',f'notice:{foreign.id}'
        user_id = agent.id
    login(client,'agent1')
    assert foreign_key not in {row['id'] for row in client.get('/api/notifications').json()['items']}
    assert client.post('/api/notifications/read',json={'ids':[key,foreign_key]}).status_code==404
    assert not next(row for row in client.get('/api/notifications').json()['items'] if row['id']==key)['read']
    for _ in range(2):
        assert client.post('/api/notifications/read',json={'ids':[key,key]}).status_code==200
    login(client,'agent1')
    assert next(row for row in client.get('/api/notifications').json()['items'] if row['id']==key)['read']
    with DB() as db:
        assert db.get(NotificationRead,(user_id,key))
    assert client.post('/api/notifications/read',json={'ids':[key],'read':False}).status_code==200
    assert not next(row for row in client.get('/api/notifications').json()['items'] if row['id']==key)['read']
    login(client,'leader2')
    assert client.post('/api/notifications/read',json={'ids':[key]}).status_code==404
