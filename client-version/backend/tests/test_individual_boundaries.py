"""Personal boundaries remain scoped, atomic and independent of staff assignment."""
from uuid import uuid4
import pytest
from sqlalchemy import func, select
import test_client_scope as shared
from test_work_location import clean_geo  # noqa: F401
from app.db import Agent, DB, User
from app.location_tracking import WorkFence, FenceAssignment

client, database, login = shared.client, shared.database, shared.login
URL = '/api/location-tracking'
BODY = {'name':'Individual member worksite','latitude':25.08,'longitude':55.141,'radius_m':250,'enabled':True}


def target(client):
    login(client,'agent1')
    person=client.get('/api/auth/me').json()
    login(client)
    return person


def test_individual_circle_does_not_change_branch_leader_or_other_members(client):
    person=target(client)
    with DB() as db:
        agent=db.get(Agent,person['agent_id']); original=(agent.outlet_id,agent.leader_id)
    branch=client.post(URL+'/fences',json={**BODY,'name':'Branch default','branch_id':person['branch_id'],'radius_m':500}).json()
    reply=client.put(URL+f"/assignments/{person['id']}/boundary",json=BODY)
    assert reply.status_code==200,reply.text
    personal=reply.json()['boundary']
    assert personal['id']!=branch['id'] and personal['branch_id'] is None and personal['radius_m']==250
    changed=client.put(URL+f"/assignments/{person['id']}/boundary",json={**BODY,'radius_m':750}).json()
    assert changed['boundary']['id']==personal['id'] and changed['boundary']['radius_m']==750
    with DB() as db:
        agent=db.get(Agent,person['agent_id']); assert (agent.outlet_id,agent.leader_id)==original
        assert db.get(WorkFence,branch['id']).radius_m==500
        assert db.scalar(select(func.count()).select_from(WorkFence))==2
    reset=client.put(URL+f"/assignments/{person['id']}",json={'fence_id':None})
    assert reset.json()['boundary']['id']==branch['id']


def test_customizing_a_shared_worksite_creates_an_independent_circle(client):
    first=target(client)
    login(client,'agent2'); second=client.get('/api/auth/me').json(); login(client)
    shared_site=client.post(URL+'/fences',json=BODY).json()
    for person in (first,second):
        assert client.put(URL+f"/assignments/{person['id']}",json={'fence_id':shared_site['id']}).status_code==200
    updated=client.put(URL+f"/assignments/{first['id']}/boundary",json={**BODY,'radius_m':1000})
    assert updated.status_code==200 and updated.json()['boundary']['id']!=shared_site['id']
    with DB() as db:
        assert db.get(WorkFence,shared_site['id']).radius_m==250
        second_assignment=db.scalar(select(FenceAssignment).where(FenceAssignment.user_id==second['id']))
        assert second_assignment.fence_id==shared_site['id']


@pytest.mark.parametrize('account',['agent1','leader','salesmanager','compliance','inventory','tele','welcome'])
def test_only_authorized_management_can_set_an_individual_boundary(client,account):
    person=target(client); login(client,account)
    assert client.put(URL+f"/assignments/{person['id']}/boundary",json=BODY).status_code==403
    with DB() as db: assert db.scalar(select(func.count()).select_from(WorkFence))==0


def test_invalid_personal_boundary_does_not_leave_an_unused_fence(client):
    person=target(client)
    for body in ({**BODY,'branch_id':person['branch_id']},{**BODY,'enabled':False},{**BODY,'radius_m':0}):
        assert client.put(URL+f"/assignments/{person['id']}/boundary",json=body).status_code==422
    assert client.put(URL+f'/assignments/{uuid4()}/boundary',json=BODY).status_code==404
    with DB() as db: assert db.scalar(select(func.count()).select_from(WorkFence))==0
