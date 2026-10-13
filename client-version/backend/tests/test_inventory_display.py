"""Inventory progress must agree with explicitly recorded historical stock."""
from sqlalchemy import select
import test_client_scope as shared
from app.db import DB, Sim, SimProgress
from app.db import Agent, Outlet, Branch, User, Role, SalesRecord
from uuid import uuid4

client, database, login = shared.client, shared.database, shared.login

def test_activated_stock_without_current_capture_is_not_not_started(client):
    login(client)
    with DB() as db:
        sim = db.scalar(select(Sim).where(~select(SimProgress.id).where(SimProgress.sim_id == Sim.id).exists()))
        assert sim is not None
        sim_id, old_status = sim.id, sim.status
        sim.status = 'ACTIVATED'
        db.commit()
    try:
        response = client.get('/api/resources/inventory')
        assert response.status_code == 200
        row = next(item for item in response.json() if item['id'] == sim_id)
        assert row['activation_stage'] == 'ACTIVATED'
        assert row['scan_transaction_id'] is None
        assert row['capture_id'] is None
        # Stock state does not imply a payment receipt or settlement.
        assert row['payment_status'] == 'NOT_UPLOADED'
    finally:
        with DB() as db:
            db.get(Sim, sim_id).status = old_status
            db.commit()

def test_leader_directory_distinguishes_current_branch_from_saved_sales(client):
    login(client)
    with DB() as db:
        agent = db.scalar(select(Agent))
        old_branch = db.get(Outlet, agent.outlet_id).branch_id
        current_branch = db.scalar(select(Branch).where(Branch.id != old_branch))
        template = db.scalar(select(User).join(Role).where(Role.name == 'Team Leader'))
        leader = User(name='Historical directory leader', email=f'directory-{uuid4()}@example.test', password_hash=template.password_hash, role_id=template.role_id, branch_id=current_branch.id)
        db.add(leader)
        db.flush()
        sale = SalesRecord(agent_id=agent.id, leader_id=leader.id, branch_id=old_branch, outlet_id=agent.outlet_id, order_type='NEW', customer_name='Synthetic history', status='CLOSED')
        db.add(sale)
        db.commit()
        leader_id, sale_id, current_id = leader.id, sale.id, current_branch.id
    try:
        response = client.get('/api/resources/team-leaders')
        assert response.status_code == 200
        rows = [row for row in response.json() if row['leader_id'] == leader_id]
        assert len(rows) == 2
        historical = next(row for row in rows if row['branch_id'] == old_branch)
        current = next(row for row in rows if row['branch_id'] == current_id)
        assert historical['historical_assignment'] is True
        assert historical['current_branch_id'] == current_id
        assert historical['activations'] == 1
        assert current['historical_assignment'] is False
        with DB() as db:
            assert db.get(SalesRecord, sale_id).branch_id == old_branch
    finally:
        with DB() as db:
            db.delete(db.get(SalesRecord, sale_id))
            db.delete(db.get(User, leader_id))
            db.commit()
