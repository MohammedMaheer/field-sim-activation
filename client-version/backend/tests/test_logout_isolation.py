"""Sign-out must terminate owned sessions even after expiry or grant revocation."""
# ruff: noqa: F401,F811
from datetime import timedelta, timezone
from uuid import uuid4
import jwt
import pytest
from sqlalchemy import select
from test_client_scope import client, database, login
from test_capture_identity import new_records
from app.db import DB, Permission, Role, now
from app.security import SECRET
from app.location_tracking import WorkSession


@pytest.mark.parametrize('revoked_location',[False,True])
def test_expired_logout_revokes_refresh_ends_work_and_preserves_other_sessions(client,revoked_location):
    login(client)
    roles=client.get('/api/organization/access').json()['roles']
    role_id=next(r['id'] for r in roles if r['name']=='Tele Verification Officer')
    email=f'logout-{uuid4()}@example.test'
    result=client.post('/api/organization/access/accounts',json={'name':'Synthetic sign-out tester','email':email,'password':'private-test-password','role_id':role_id})
    assert result.status_code==201,result.text
    session=client.post('/api/auth/login',json={'email':email,'password':'private-test-password','native':True}).json()
    authorization={'Authorization':'Bearer '+session['access_token']}
    started=client.post('/api/location-tracking/start',headers=authorization,json={'latitude':25.08,'longitude':55.14,'accuracy_m':10,'captured_at':now().replace(tzinfo=timezone.utc).isoformat(),'device':'Explicit isolated test device','mocked':False})
    assert started.status_code==200,started.text
    work_id=started.json()['work_session']['id']
    claims=jwt.decode(session['access_token'],SECRET,algorithms=['HS256'],audience='relay')
    expired=jwt.encode({**claims,'exp':(now()-timedelta(minutes=1)).timestamp()},SECRET,algorithm='HS256')
    mismatched=jwt.encode({**claims,'sub':str(uuid4())},SECRET,algorithm='HS256')
    assert client.post('/api/auth/logout',headers={'Authorization':'Bearer '+mismatched}).status_code==401
    grant_id=None
    if revoked_location:
        with DB() as db:
            grant=db.scalar(select(Permission).where(Permission.role_id==role_id,Permission.name=='location.self'))
            grant_id=grant.id;grant.name='location.revoked';db.commit()
    try:
        result=client.post('/api/auth/logout',headers={'Authorization':'Bearer '+expired})
        assert result.status_code==200,result.text
        with DB() as db:assert db.get(WorkSession,work_id).ended_at is not None
        assert client.post('/api/auth/refresh',json={'refresh_token':session['refresh_token']}).status_code==401
        assert client.post('/api/auth/logout',headers={'Authorization':'Bearer '+expired}).status_code==200
    finally:
        if grant_id:
            with DB() as db:db.get(Permission,grant_id).name='location.self';db.commit()
    # Revoking this caller does not revoke the independent Super admin session.
    assert client.get('/api/auth/me').status_code==200
