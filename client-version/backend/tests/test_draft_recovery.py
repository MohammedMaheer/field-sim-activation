"""Saved drafts survive retries without creating extra customer transactions."""

from uuid import uuid4

import pytest
from test_client_scope import client as client, database as database, login
from sqlalchemy import delete, select

from app.db import DB, CaptureTransactionOutcome, SavedCaptureDraft


@pytest.fixture(autouse=True)
def restore_drafts(database):
    with DB() as db:
        previous = {
            model: set(db.scalars(select(model.id)))
            for model in (SavedCaptureDraft, CaptureTransactionOutcome)
        }
    yield
    with DB() as db:
        for model, identifiers in previous.items():
            db.execute(delete(model).where(model.id.not_in(identifiers)))
        db.commit()


def test_named_draft_retry_reuses_transaction_after_lost_response(client):
    login(client, "agent1")
    transaction = str(uuid4())
    body = {"data": {"transaction_id": transaction, "name": "Retained customer"}}
    first = client.post("/api/kyc-captures/saved-drafts", json=body)
    assert first.status_code == 201, first.text
    # Simulate a committed response lost before the client obtained its saved ID.
    again = client.post("/api/kyc-captures/saved-drafts", json=body)
    assert again.status_code == 201, again.text
    assert again.json()["id"] == first.json()["id"]
    rows = client.get("/api/kyc-captures/saved-drafts").json()
    assert len([r for r in rows if r["data"]["transaction_id"] == transaction]) == 1


def test_named_draft_offline_retry_reuses_server_copy_and_keeps_accounts_private(client):
    login(client, "agent1")
    transaction = str(uuid4())
    first = client.post(
        "/api/kyc-captures/saved-drafts",
        json={
            "data": {"transaction_id": transaction, "name": "Original"},
        },
    ).json()
    # Flutter can assign a local saved ID after a transport failure.
    retry = client.post(
        "/api/kyc-captures/saved-drafts",
        json={
            "data": {
                "transaction_id": transaction,
                "name": "Edited offline",
                "saved_draft_id": str(uuid4()),
            },
        },
    )
    assert retry.status_code == 201, retry.text
    assert retry.json()["id"] == first["id"]
    assert retry.json()["data"]["name"] == "Edited offline"
    login(client, "agent2")
    denied = client.post(
        "/api/kyc-captures/saved-drafts",
        json={
            "data": {"transaction_id": transaction, "saved_draft_id": first["id"]},
        },
    )
    assert denied.status_code == 404
    assert not any(
        r["id"] == first["id"] for r in client.get("/api/kyc-captures/saved-drafts").json()
    )


def test_retry_at_draft_limit_succeeds_but_new_transaction_is_rejected(client):
    login(client, "agent1")
    previous = client.get("/api/kyc-captures/saved-drafts").json()
    saved = None
    for _ in range(20 - len(previous)):
        body = {"data": {"transaction_id": str(uuid4()), "name": "Capacity check"}}
        saved = client.post("/api/kyc-captures/saved-drafts", json=body)
        assert saved.status_code == 201, saved.text
    assert saved is not None
    retry = client.post("/api/kyc-captures/saved-drafts", json=body)
    assert retry.status_code == 201 and retry.json()["id"] == saved.json()["id"]
    extra = client.post(
        "/api/kyc-captures/saved-drafts", json={"data": {"transaction_id": str(uuid4())}}
    )
    assert extra.status_code == 409 and "20 drafts" in extra.json()["detail"]
    assert len(client.get("/api/kyc-captures/saved-drafts").json()) == 20


def test_unidentified_legacy_drafts_are_not_merged(client):
    login(client, "agent1")
    first = client.post(
        "/api/kyc-captures/saved-drafts", json={"data": {"name": "Legacy A"}}
    ).json()
    second = client.post(
        "/api/kyc-captures/saved-drafts", json={"data": {"name": "Legacy B"}}
    ).json()
    assert first["id"] != second["id"]
    edited = client.post(
        "/api/kyc-captures/saved-drafts",
        json={
            "data": {
                "saved_draft_id": first["id"],
                "name": "Legacy A edited",
            }
        },
    )
    assert edited.status_code == 201 and edited.json()["id"] == first["id"]
