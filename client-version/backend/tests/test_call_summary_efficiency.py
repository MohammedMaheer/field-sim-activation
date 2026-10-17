"""Header counts retain queue scope and timing without serializing evidence."""
from datetime import timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select
from test_client_scope import client, database, login
from test_sales_policy_october import policy_records
from app.db import Agent, DB, Outlet, SalesRecord, SalesCallTask, business_date, now
from app import sales_management as sales


@pytest.fixture
def queued_calls(policy_records):
    branches=[]
    with DB() as db:
        for agent in list(db.scalars(select(Agent)))[:4]:
            branch=db.get(Outlet,agent.outlet_id).branch_id
            branches.append(branch)
            for index,(status,tele,welcome) in enumerate([
                ("IN_PROGRESS","PENDING","BLOCKED"),
                ("CLOSED","COMPLETED","BLOCKED"),
                ("CLOSED","FAILED","BLOCKED"),
                ("CANCELLED","PENDING","PENDING"),
                ("CLOSED","COMPLETED","COMPLETED"),
            ]):
                at=now()-timedelta(days=index)
                row=SalesRecord(agent_id=agent.id,leader_id=agent.leader_id,branch_id=branch,
                    outlet_id=agent.outlet_id,order_type="NEW",customer_name="Summary QA",
                    request_id="SUMMARY-"+uuid4().hex,status=status,created_at=at,
                    details={"tele_deferred_until":(business_date(at)+timedelta(days=1)).isoformat()} if index==2 else {})
                db.add(row);db.flush()
                db.add_all([SalesCallTask(sale_id=row.id,stage="TELE_VERIFICATION",status=tele),
                            SalesCallTask(sale_id=row.id,stage="WELCOME_CALL",status=welcome)])
        db.commit()
    return branches


@pytest.mark.parametrize("account",["admin","ops","leader","agent1","agent2","cluster","compliance","salesmanager","tele","welcome"])
@pytest.mark.parametrize("scope",["all","branch","missing"])
def test_lightweight_summary_matches_scoped_queue_without_evidence_reads(client,queued_calls,monkeypatch,account,scope):
    login(client,account)
    params={} if scope=="all" else {"branch_id":queued_calls[0] if scope=="branch" else str(uuid4())}
    response=client.get("/api/sales-management/call-tasks",params=params)
    assert response.status_code==200,response.text
    rows=response.json()
    expected={
        "actionable":sum(row["status"] in {"PENDING","FAILED"} for row in rows),
        "pending_tele":sum(row["stage"]=="TELE_VERIFICATION" and row["status"]=="PENDING" for row in rows),
        "pending_welcome":sum(row["stage"]=="WELCOME_CALL" and row["status"]=="PENDING" for row in rows),
        "blocked_welcome":sum(row["stage"]=="WELCOME_CALL" and row["status"]=="BLOCKED" for row in rows),
        "overdue":sum(row["overdue"] for row in rows),
        "sequence_warnings":len({row["sale_id"] for row in rows if row["sequence_warning"]}),
    }
    def fail_serialization(*args):
        raise AssertionError("Summary must not load customer/evidence/SR views")
    monkeypatch.setattr(sales,"sale_view",fail_serialization)
    summary=client.get("/api/sales-management/call-tasks/summary",params=params)
    assert summary.status_code==200,summary.text
    assert summary.json()==expected
