"""Rotation retries recover lost responses within one fixed ten-second window."""

# ruff: noqa: F401,F811
from datetime import timedelta

import jwt
import pytest
from sqlalchemy import select

from test_client_scope import client, database
from app import main
from app.db import Agent, DB, Permission, Session, User
from app.security import SECRET, cipher, digest


@pytest.fixture
def clock(monkeypatch):
    timestamp = [main.now()]
    monkeypatch.setattr(main, "now", lambda: timestamp[0])
    return timestamp


def sign_in(client, account="agent1", native=True):
    response = client.post(
        "/api/auth/login",
        json={
            "email": account + "@relay.demo",
            "password": "test-client-password",
            "native": native,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def session_id(data):
    return jwt.decode(data["access_token"], SECRET, algorithms=["HS256"], audience="relay")["sid"]


def renew(client, token):
    return client.post("/api/auth/refresh", json={"refresh_token": token})


def recovery_snapshot(ident):
    with DB() as db:
        row = db.get(Session, ident)
        return (
            row.refresh_hash,
            row.previous_refresh_hash,
            row.refresh_retry_until,
            row.refresh_retry_encrypted,
            row.expires,
        )


def test_native_lost_response_recovers_same_rotation_without_extending_window(client, clock):
    initial = sign_in(client)
    ident = session_id(initial)
    predecessor = initial["refresh_token"]
    first = renew(client, predecessor)
    assert first.status_code == 200, first.text
    replacement = first.json()["refresh_token"]
    assert replacement != predecessor
    state = recovery_snapshot(ident)
    assert state[0] == digest(replacement) and state[1] == digest(predecessor)
    assert state[2] == clock[0] + timedelta(seconds=10)
    assert cipher.decrypt(state[3].encode()).decode() == replacement
    assert replacement not in state[3] and predecessor not in state[3]
    clock[0] += timedelta(seconds=9)
    # Retry the discarded response's predecessor, then the newly saved token.
    for token in (predecessor, replacement, predecessor, replacement):
        retry = renew(client, token)
        assert retry.status_code == 200, retry.text
        assert retry.json()["refresh_token"] == replacement
        assert retry.json()["user"]["id"] == initial["user"]["id"]
        assert recovery_snapshot(ident) == state


def test_cookie_discarded_response_and_rapid_reload_share_same_cookie(client, clock):
    initial = sign_in(client, "admin", native=False)
    predecessor = client.cookies.get("relay_refresh")
    first = client.post("/api/auth/refresh", json={})
    assert first.status_code == 200 and "refresh_token" not in first.json()
    replacement = client.cookies.get("relay_refresh")
    assert predecessor != replacement
    state = recovery_snapshot(session_id(initial))
    clock[0] += timedelta(seconds=8)
    for cookie in (predecessor, replacement, predecessor):
        response = client.post(
            "/api/auth/refresh",
            json={},
            headers={"Cookie": f"relay_refresh={cookie}"},
        )
        assert response.status_code == 200, response.text
        assert "refresh_token" not in response.json()
        assert client.cookies.get("relay_refresh") == replacement
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "SameSite=strict" in response.headers["set-cookie"]
        assert recovery_snapshot(session_id(initial)) == state


def test_expired_overlap_rejects_previous_and_rotates_current_once(client, clock):
    initial = sign_in(client)
    predecessor = initial["refresh_token"]
    first = renew(client, predecessor)
    replacement = first.json()["refresh_token"]
    ident = session_id(initial)
    original = recovery_snapshot(ident)
    clock[0] += timedelta(seconds=10)
    expired = renew(client, predecessor)
    assert expired.status_code == 401 and "set-cookie" not in expired.headers
    assert recovery_snapshot(ident) == original
    second = renew(client, replacement)
    assert second.status_code == 200
    next_token = second.json()["refresh_token"]
    assert next_token not in (replacement, predecessor)
    state = recovery_snapshot(ident)
    assert state[0] == digest(next_token) and state[1] == digest(replacement)
    assert state[2] == clock[0] + timedelta(seconds=10)
    assert state[4] == original[4], "Rotation must not extend session expiry"
    assert renew(client, predecessor).status_code == 401
    assert renew(client, replacement).json()["refresh_token"] == next_token
    assert renew(client, next_token).json()["refresh_token"] == next_token


@pytest.mark.parametrize("blocked", ["revoked", "expired", "role_grants", "inactive_agent"])
def test_recovery_cannot_bypass_session_or_account_revocation(client, clock, blocked):
    initial = sign_in(client)
    predecessor = initial["refresh_token"]
    replacement = renew(client, predecessor).json()["refresh_token"]
    ident = session_id(initial)
    grants = []
    actor_id = initial["user"]["id"]
    agent_id, employment = None, None
    with DB() as db:
        session = db.get(Session, ident)
        if blocked == "revoked":
            session.revoked = True
        elif blocked == "expired":
            session.expires = clock[0]
        elif blocked == "role_grants":
            actor = db.get(User, actor_id)
            for grant in db.scalars(select(Permission).where(Permission.role_id == actor.role_id)):
                grants.append((grant.id, grant.name))
                grant.name = "removed-for-isolated-recovery-test"
        else:
            agent = db.scalar(select(Agent).where(Agent.user_id == actor_id))
            agent_id, employment = agent.id, agent.employment_status
            agent.employment_status = "EXITED"
        db.commit()
    try:
        for token in (predecessor, replacement):
            denied = renew(client, token)
            assert denied.status_code == 401 and "set-cookie" not in denied.headers
    finally:
        with DB() as db:
            for ident, name in grants:
                db.get(Permission, ident).name = name
            if agent_id:
                db.get(Agent, agent_id).employment_status = employment
            db.commit()


def test_native_invalid_token_does_not_fall_back_to_another_accounts_cookie(client, clock):
    actor = sign_in(client)
    actor_token = renew(client, actor["refresh_token"]).json()["refresh_token"]
    admin = sign_in(client, "admin", native=False)
    admin_cookie = client.cookies.get("relay_refresh")
    admin_state = recovery_snapshot(session_id(admin))
    denied = renew(client, "not-a-valid-token")
    assert denied.status_code == 401 and "set-cookie" not in denied.headers
    assert client.cookies.get("relay_refresh") == admin_cookie
    assert recovery_snapshot(session_id(admin)) == admin_state
    actor_retry = renew(client, actor["refresh_token"])
    assert actor_retry.status_code == 200
    assert actor_retry.json()["refresh_token"] == actor_token
    assert actor_retry.json()["user"]["id"] == actor["user"]["id"]
    assert session_id(actor_retry.json()) == session_id(actor)


def test_demo_recovery_preserves_independent_portal_cookie(client, clock, monkeypatch):
    monkeypatch.setenv("MOBILE_DEMO_LOGIN_ENABLED", "true")
    admin = sign_in(client, "admin", native=False)
    portal_cookie = client.cookies.get("relay_refresh")
    initial = client.post("/api/auth/mobile-demo/login", json={"email": "agent1@relay.demo"}).json()
    predecessor = initial["refresh_token"]
    first = renew(client, predecessor)
    assert first.status_code == 200 and "set-cookie" not in first.headers
    replacement = first.json()["refresh_token"]
    for token in (predecessor, replacement):
        retry = renew(client, token)
        assert retry.status_code == 200 and "set-cookie" not in retry.headers
        assert retry.json()["refresh_token"] == replacement
        assert client.cookies.get("relay_refresh") == portal_cookie
        assert retry.json()["user"]["id"] != admin["user"]["id"]
    logout = client.post(
        "/api/auth/logout",
        headers={"Authorization": "Bearer " + first.json()["access_token"]},
    )
    assert logout.status_code == 200 and "set-cookie" not in logout.headers
    assert renew(client, predecessor).status_code == 401
    assert renew(client, replacement).status_code == 401
    portal = client.post("/api/auth/refresh", json={})
    assert portal.status_code == 200
    assert portal.json()["user"]["id"] == admin["user"]["id"]


@pytest.mark.parametrize("cache", [None, "invalid-encrypted-cache", "different-valid-token"])
def test_retry_cache_is_authenticated_and_hash_bound(client, clock, cache):
    initial = sign_in(client)
    predecessor = initial["refresh_token"]
    replacement = renew(client, predecessor).json()["refresh_token"]
    with DB() as db:
        row = db.get(Session, session_id(initial))
        row.refresh_retry_encrypted = (
            cipher.encrypt(cache.encode()).decode() if cache == "different-valid-token" else cache
        )
        db.commit()
    assert renew(client, predecessor).status_code == 401
    assert renew(client, replacement).status_code == 401
    # A valid current token can rotate after the fixed cache window ends.
    clock[0] += timedelta(seconds=10)
    assert renew(client, replacement).status_code == 200
