"""Call writes share the sale lock with cancellation, review and reconciliation."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select
from starlette.requests import Request

from test_postgres_assignment_locks import postgres_sessions  # noqa: F401
from app.db import Agent, CallAttempt, Outlet, SalesCallTask, SalesRecord, User
from app import sales_management as sales


@pytest.fixture
def call_sales(postgres_sessions):
    with postgres_sessions() as db:
        agent = db.scalar(select(Agent).where(Agent.employment_status == 'ACTIVE'))
        branch = db.get(Outlet, agent.outlet_id).branch_id
        ids = []
        for _ in range(2):
            row = SalesRecord(agent_id=agent.id, leader_id=agent.leader_id, branch_id=branch,
                outlet_id=agent.outlet_id, order_type='NEW', customer_name='Isolated call lock95',
                request_id='LOCK95-'+uuid4().hex, status='IN_PROGRESS', details={})
            db.add(row); db.flush(); sales.create_call_tasks(db, row); ids.append(row.id)
        db.commit()
    yield ids
    with postgres_sessions() as db:
        db.execute(delete(CallAttempt).where(CallAttempt.sale_id.in_(ids)))
        db.execute(delete(SalesCallTask).where(SalesCallTask.sale_id.in_(ids)))
        db.execute(delete(SalesRecord).where(SalesRecord.id.in_(ids)))
        db.commit()


def test_busy_sale_returns_conflict_and_independent_sale_can_record(postgres_sessions, call_sales):
    entered, release = Event(), Event()
    def cancel():
        with postgres_sessions() as db:
            row = db.scalar(select(SalesRecord).where(SalesRecord.id == call_sales[0]).with_for_update())
            row.status = 'CANCELLED'; db.flush(); entered.set()
            assert release.wait(15)
            db.commit()
    request = Request({'type':'http','method':'POST','path':'/qa/call-lock95','headers':[], 'client':('127.0.0.1',0)})
    body = sales.CallWrite(stage='TELE_VERIFICATION', outcome='NO_ANSWER', remark='Customer did not answer')
    with postgres_sessions() as cached, ThreadPoolExecutor(max_workers=1) as worker:
        cached_row = cached.get(SalesRecord, call_sales[0])
        assert cached_row.status == 'IN_PROGRESS'
        actor = cached.scalar(select(User).where(User.email == 'admin@relay.demo'))
        future = worker.submit(cancel)
        try:
            assert entered.wait(5)
            with pytest.raises(HTTPException) as conflict:
                sales.record_call(call_sales[0], body, request, user=actor, db=cached)
            assert conflict.value.status_code == 409 and 'updated' in conflict.value.detail
            result = sales.record_call(call_sales[1], body, request, user=actor, db=cached)
            assert result['recorded']
        finally:
            release.set()
        future.result(5)
        with pytest.raises(HTTPException) as cancelled:
            sales.record_call(call_sales[0], body, request, user=actor, db=cached)
        assert cancelled.value.status_code == 409 and 'cancelled' in cancelled.value.detail
    with postgres_sessions() as db:
        assert db.get(SalesRecord, call_sales[0]).status == 'CANCELLED'
        assert not db.scalar(select(CallAttempt.id).where(CallAttempt.sale_id == call_sales[0]))
