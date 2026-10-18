"""Stock detail scope, filtering before caps and bounded relationship reads."""
from datetime import timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import event, select

from test_client_scope import client, database, login  # noqa: F401
from test_branch_leaders import branch, leader, agent_body, new_records_only  # noqa: F401
from app.db import Agent, Branch, DB, FieldAsset, FieldAssetMovement, FieldAssetRequest, Movement, Outlet, Sim, User, engine, now
from app import field_assets


@pytest.fixture
def stock_group(client, new_records_only):
    login(client)
    branch_id = branch(client)
    first, account = leader(client, branch_id)
    second, _ = leader(client, branch_id)
    own = client.post('/api/organization/agents', json=agent_body(branch_id, first)).json()['id']
    other = client.post('/api/organization/agents', json=agent_body(branch_id, second)).json()['id']
    with DB() as db:
        admin = db.scalar(select(User).where(User.email == 'admin@relay.demo'))
        assets = [FieldAsset(category='UNIFORM', label=label, quantity=1, branch_id=branch_id,
                            agent_id=agent, status='ASSIGNED' if agent else 'AVAILABLE')
                  for label, agent in [('Own stock scope95', own), ('Other leader stock scope95', other), ('Branch pool scope95', None)]]
        db.add_all(assets); db.flush()
        for asset in assets:
            db.add(FieldAssetMovement(asset_id=asset.id, from_branch_id=branch_id, to_branch_id=branch_id,
                to_agent_id=asset.agent_id, actor_id=admin.id, reason=asset.label))
        db.commit()
        return {'branch': branch_id, 'account': account, 'own': own, 'other': other,
                'assets': [asset.id for asset in assets]}


def test_leader_sees_own_assigned_stock_and_shared_pool_not_sibling_leader_details(client, stock_group):
    group = stock_group
    login(client, group['account'])
    rows = client.get('/api/field-assets', params={'branch_id': group['branch']})
    assert rows.status_code == 200
    assert {row['id'] for row in rows.json()} == {group['assets'][0], group['assets'][2]}
    assert client.get(f"/api/field-assets/{group['assets'][1]}/history").status_code == 404
    movement = client.get('/api/field-assets/report/movements', params={'branch_id': group['branch']})
    assert movement.status_code == 200
    assert 'Other leader stock scope95' not in movement.text
    assert 'Own stock scope95' in movement.text and 'Branch pool scope95' in movement.text
    exported = client.get('/api/field-assets/report/export', params={'kind':'stock','branch_id':group['branch']})
    assert exported.status_code == 200 and 'Other leader stock scope95' not in exported.text


@pytest.mark.parametrize('kind', ['stock', 'requests', 'movements'])
def test_stock_export_applies_filters_before_its_row_cap(client, new_records_only, kind):
    login(client)
    with DB() as db:
        admin = db.scalar(select(User).where(User.email == 'admin@relay.demo'))
        agents = list(db.scalars(select(Agent).order_by(Agent.id)))
        first = agents[0]
        own_outlet = db.get(Outlet, first.outlet_id)
        foreign = next(agent for agent in agents if db.get(Outlet, agent.outlet_id).branch_id != own_outlet.branch_id)
        foreign_outlet = db.get(Outlet, foreign.outlet_id)
        own_time, foreign_time = now()-timedelta(days=1), now()
        marker = 'FILTER95-' + uuid4().hex
        if kind == 'stock':
            db.add(FieldAsset(category='UNIFORM', label=marker, quantity=1, branch_id=own_outlet.branch_id, created_at=own_time))
            db.add_all([FieldAsset(category='UNIFORM', label='Foreign capped item', quantity=1, branch_id=foreign_outlet.branch_id, created_at=foreign_time) for _ in range(1001)])
        elif kind == 'requests':
            db.add(FieldAssetRequest(agent_id=first.id, branch_id=own_outlet.branch_id, category='UNIFORM', quantity=1, reason=marker, urgency='NORMAL', status='REQUESTED', created_at=own_time))
            db.add_all([FieldAssetRequest(agent_id=foreign.id, branch_id=foreign_outlet.branch_id, category='UNIFORM', quantity=1, reason='Foreign capped request', urgency='NORMAL', status='REQUESTED', created_at=foreign_time) for _ in range(1001)])
        else:
            own_sim = Sim(iccid=uuid4().hex, serial=marker, outlet_id=first.outlet_id, sim_type='Physical', business_category='Postpaid', status='AVAILABLE')
            foreign_sim = Sim(iccid=uuid4().hex, serial=uuid4().hex, outlet_id=foreign.outlet_id, sim_type='Physical', business_category='Postpaid', status='AVAILABLE')
            db.add_all([own_sim, foreign_sim]); db.flush()
            db.add(Movement(sim_id=own_sim.id, agent_id=first.id, user_id=admin.id, old_status='AVAILABLE', new_status='AVAILABLE', reason=marker, created_at=own_time))
            db.add_all([Movement(sim_id=foreign_sim.id, agent_id=foreign.id, user_id=admin.id, old_status='AVAILABLE', new_status='AVAILABLE', reason='Foreign capped movement', created_at=foreign_time) for _ in range(1001)])
        db.commit()
        branch_id = own_outlet.branch_id
    result = client.get('/api/field-assets/report/export', params={'kind':kind, 'format':'csv', 'branch_id':branch_id})
    assert result.status_code == 200
    assert marker in result.text
    assert 'Foreign capped' not in result.text


def test_asset_register_relationship_queries_do_not_grow_per_item(client, new_records_only):
    with DB() as db:
        owner = db.scalar(select(Agent))
        branch_id = db.get(Outlet, owner.outlet_id).branch_id
        db.add_all([FieldAsset(category='UNIFORM', label=f'Read efficiency95 {n}', quantity=1,
            branch_id=branch_id, agent_id=owner.id, status='ASSIGNED') for n in range(50)])
        db.commit()
    statements = []
    with DB() as db:
        admin = db.scalar(select(User).where(User.email == 'admin@relay.demo'))
        def capture(*args): statements.append(args[2])
        event.listen(engine, 'before_cursor_execute', capture)
        try:
            rows = field_assets.assets(user=admin, db=db)
        finally:
            event.remove(engine, 'before_cursor_execute', capture)
    assert sum(row['label'].startswith('Read efficiency95') for row in rows) == 50
    assert len(statements) <= 14, len(statements)


def test_stock_dates_normalize_offsets_and_reject_inverted_ranges():
    from datetime import datetime
    start = datetime(2030, 1, 1, 4, tzinfo=timezone(timedelta(hours=4)))
    end = datetime(2030, 1, 1, 5, tzinfo=timezone(timedelta(hours=4)))
    assert field_assets.stock_dates(start, end) == (datetime(2030, 1, 1), datetime(2030, 1, 1, 1))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        field_assets.stock_dates(end, start)
    assert error.value.status_code == 422
