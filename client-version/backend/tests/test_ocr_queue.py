"""Durable scanner admission, privacy, leases and connection ownership."""
import base64
import hashlib
import io
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import delete, select, update

from test_client_scope import client, database, login  # noqa: F401
from app import captures, main, ocr_queue as jobs
from app.db import Agent, DB, KycCapture, Permission, User, engine, now
from app.security import cipher


@pytest.fixture(autouse=True)
def isolated_queue(database, monkeypatch):  # noqa: F811
    # Explicit worker calls make races deterministic; never touch hosted data.
    monkeypatch.setattr(main, "process_ocr_job", lambda: False)
    monkeypatch.setattr(main, "process_capture", lambda: False)
    with DB() as db:
        previous = {row.id: row.status for row in db.scalars(select(KycCapture).where(KycCapture.status == "QUEUED"))}
        captures_before = set(db.scalars(select(KycCapture.id)))
        jobs_before = set(db.scalars(select(jobs.OcrJob.id)))
        if previous:
            db.execute(update(KycCapture).where(KycCapture.id.in_(previous)).values(status="EXTRACTED"))
        db.commit()
    yield
    with DB() as db:
        db.execute(delete(jobs.OcrJob).where(jobs.OcrJob.id.not_in(jobs_before)))
        # Only a direct legacy fixture is inserted here; no identity/sale children.
        db.execute(delete(KycCapture).where(KycCapture.id.not_in(captures_before)))
        for identifier, status in previous.items():
            db.get(KycCapture, identifier).status = status
        db.commit()


def photo(color="white"):
    stream = io.BytesIO()
    Image.new("RGB", (200, 100), color).save(stream, format="PNG")
    return base64.b64encode(stream.getvalue()).decode()


def body(stage="DOCUMENT", **changes):
    return {"stage": stage, "operation_id": str(uuid4()), "image_base64": photo(), **changes}


def submit(client, data=None):
    result = client.post("/api/kyc-captures/ocr-jobs", json=data or body())
    assert result.status_code == 202, result.text
    return result.json()


def fake_parsers(monkeypatch):
    monkeypatch.setattr(captures, "parse_document_result", lambda result, image, user: {"name": "Queue Customer", "document_check": "signed-proof"}, raising=False)
    monkeypatch.setattr(captures, "parse_order_result", lambda result, image, user, db: {"order_reference": "QUEUE-ORDER-123", "order_check": "signed-proof"}, raising=False)
    monkeypatch.setattr(captures, "parse_receipt_result", lambda result, image, user: {"fields": {"sr_number": "SR-QUEUE-123"}, "sr_check": "signed-proof"}, raising=False)


def test_route_is_static_owner_private_and_idempotent(client):  # noqa: F811
    login(client, "agent1")
    data = body()
    first = submit(client, data)
    replay = submit(client, data)
    assert replay["id"] == first["id"] and replay["status"] == "QUEUED"
    assert client.post("/api/kyc-captures/ocr-jobs", json={**data, "image_base64": photo("blue")}).status_code == 409
    assert client.post("/api/kyc-captures/ocr-jobs", json={**data, "stage": "ORDER"}).status_code == 409
    assert "no-store" in client.get("/api/kyc-captures/ocr-jobs/" + first["id"]).headers["cache-control"]
    with DB() as db:
        row = db.get(jobs.OcrJob, first["id"])
        assert row.image_encrypted.startswith("gAAAA") and row.image_encrypted != data["image_base64"]
        assert cipher.decrypt(row.image_encrypted.encode()) == base64.b64decode(data["image_base64"])
    login(client, "agent2")
    assert client.get("/api/kyc-captures/ocr-jobs/" + first["id"]).status_code == 404
    assert submit(client, data)["id"] != first["id"]


@pytest.mark.parametrize("account", ["admin", "leader", "leader2", "cluster", "compliance", "inventory", "salesmanager", "tele", "welcome"])
def test_jobs_deny_non_capture_roles(client, account):  # noqa: F811
    login(client, account)
    assert client.post("/api/kyc-captures/ocr-jobs", json=body()).status_code == 403
    assert client.get("/api/kyc-captures/ocr-jobs/missing").status_code == 403


@pytest.mark.parametrize("stage,field", [("DOCUMENT", "document_check"), ("ORDER", "order_check"), ("RECEIPT", "sr_check")])
def test_worker_releases_checkout_and_completes_flat_encrypted_result(client, monkeypatch, stage, field):  # noqa: F811
    login(client, "ops")
    row = submit(client, body(stage))
    fake_parsers(monkeypatch)

    def extract(data):
        assert engine.pool.checkedout() == 0, "OCR must not hold a database checkout"
        with DB() as db:
            active = db.get(jobs.OcrJob, row["id"])
            assert active.status == "PROCESSING" and active.lease_token
        return {"lines": [{"text": "Customer details"}]}

    monkeypatch.setattr(jobs.extractor, "extract", extract)
    assert jobs.process_ocr_job()
    result = client.get("/api/kyc-captures/ocr-jobs/" + row["id"]).json()
    assert result["status"] == "COMPLETED" and result["result"][field] == "signed-proof"
    with DB() as db:
        stored = db.get(jobs.OcrJob, row["id"])
        assert stored.image_encrypted == "" and "signed-proof" not in stored.result_encrypted
        assert stored.result_encrypted.startswith("gAAAA") and stored.lease_token is None


def test_simultaneous_exact_retries_create_one_job(client):  # noqa: F811
    login(client, "agent1")
    data, ready = body(), Barrier(2)

    def send():
        ready.wait(5)
        return client.post("/api/kyc-captures/ocr-jobs", json=data)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [future.result(10) for future in [executor.submit(send), executor.submit(send)]]
    assert all(response.status_code == 202 for response in results), [response.text for response in results]
    assert len({response.json()["id"] for response in results}) == 1


def test_admission_bound_and_exact_replay_when_full(client, monkeypatch):  # noqa: F811
    login(client, "agent1")
    data = body()
    first = submit(client, data)
    submit(client)
    denied = client.post("/api/kyc-captures/ocr-jobs", json=body())
    assert denied.status_code == 429 and denied.headers["retry-after"] == "2"
    assert submit(client, data)["id"] == first["id"]
    monkeypatch.setattr(jobs, "QUEUE_LIMIT", 2)
    login(client, "agent2")
    denied = client.post("/api/kyc-captures/ocr-jobs", json=body())
    assert denied.status_code == 429


def test_only_one_worker_claim_and_old_lease_cannot_complete(client, monkeypatch):  # noqa: F811
    login(client, "agent1")
    row = submit(client)
    fake_parsers(monkeypatch)
    ready = Barrier(2)

    def claim():
        ready.wait(5)
        return jobs.claim_job()

    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = [future.result(10) for future in [executor.submit(claim), executor.submit(claim)]]
    old = next(value for value in claims if value)
    assert sum(value is not None for value in claims) == 1
    with DB() as db:
        db.get(jobs.OcrJob, row["id"]).lease_until = now() - timedelta(seconds=1)
        db.commit()
    new = jobs.claim_job()
    assert new["token"] != old["token"]
    assert not jobs.finish_job(old, {"lines": []})
    assert jobs.finish_job(new, {"lines": []})
    assert not jobs.finish_job(new, {"lines": []})
    with DB() as db:
        assert db.get(jobs.OcrJob, row["id"]).attempts == 2


def test_timeout_retries_are_bounded_and_unreadable_does_not_retry(client, monkeypatch):  # noqa: F811
    login(client, "agent1")
    first = submit(client)
    fake_parsers(monkeypatch)

    def timeout(data):
        raise subprocess.TimeoutExpired("synthetic-ocr", 45)

    monkeypatch.setattr(jobs.extractor, "extract", timeout)
    for attempt in range(3):
        assert jobs.process_ocr_job()
        with DB() as db:
            row = db.get(jobs.OcrJob, first["id"])
            assert row.attempts == attempt + 1
            if attempt < 2:
                assert row.status == "QUEUED" and row.image_encrypted
                row.available_at = now()
            else:
                assert row.status == "FAILED" and row.image_encrypted == ""
            db.commit()
    second = submit(client)
    monkeypatch.setattr(jobs.extractor, "extract", lambda _: (_ for _ in ()).throw(ValueError("unreadable")))
    jobs.process_ocr_job()
    with DB() as db:
        row = db.get(jobs.OcrJob, second["id"])
        assert row.status == "FAILED" and row.attempts == 1 and row.image_encrypted == ""


def test_busy_retains_photo_without_consuming_crash_retry_budget(client, monkeypatch):  # noqa: F811
    login(client, "agent1")
    row = submit(client)
    fake_parsers(monkeypatch)
    monkeypatch.setattr(jobs.extractor, "extract", lambda _: (_ for _ in ()).throw(jobs.OcrBusy()))
    jobs.process_ocr_job()
    with DB() as db:
        stored = db.get(jobs.OcrJob, row["id"])
        assert stored.status == "QUEUED" and stored.image_encrypted and stored.attempts == 0
        assert stored.available_at > now()


def test_revoked_capture_access_prevents_result_publication(client, monkeypatch):  # noqa: F811
    auth = login(client, "agent1")
    row = submit(client)
    fake_parsers(monkeypatch)
    claim = jobs.claim_job()
    with DB() as db:
        user = db.get(User, auth["user"]["id"])
        grant = db.scalar(select(Permission).where(Permission.role_id == user.role_id, Permission.name == "ekyc.write"))
        original = {"id": grant.id, "role_id": grant.role_id, "name": grant.name}
        db.delete(grant)
        db.commit()
    try:
        assert jobs.finish_job(claim, {"lines": []})
        with DB() as db:
            stored = db.get(jobs.OcrJob, row["id"])
            assert stored.status == "FAILED" and stored.result_encrypted == stored.image_encrypted == ""
        assert client.get("/api/kyc-captures/ocr-jobs/" + row["id"]).status_code == 403
    finally:
        with DB() as db:
            db.add(Permission(**original))
            db.commit()


def test_expiry_and_retention_bound_sensitive_temporary_evidence(client, monkeypatch):  # noqa: F811
    login(client, "agent1")
    row = submit(client)
    with DB() as db:
        owner = db.get(jobs.OcrJob, row["id"]).user_id
        db.get(jobs.OcrJob, row["id"]).created_at = now() - timedelta(minutes=16)
        for index in range(6):
            db.add(jobs.OcrJob(user_id=owner, operation_id=str(uuid4()), stage="DOCUMENT", image_hash="0" * 64,
                image_encrypted="", status="COMPLETED", result_encrypted=cipher.encrypt(b'{}').decode(),
                finished_at=now() - timedelta(minutes=index)))
        aged = jobs.OcrJob(user_id=owner, operation_id=str(uuid4()), stage="DOCUMENT", image_hash="0" * 64,
            image_encrypted="", status="COMPLETED", result_encrypted=cipher.encrypt(b'{}').decode(),
            finished_at=now() - timedelta(hours=25))
        db.add(aged)
        db.commit()
        aged_id = aged.id
    monkeypatch.setattr(jobs, "MAX_RETAINED", 5)
    new = submit(client)
    with DB() as db:
        assert db.get(jobs.OcrJob, aged_id) is None
        assert len(list(db.scalars(select(jobs.OcrJob)))) <= 5
        # Expired job may have been evicted by the count bound; neither path retains its photo.
        expired = db.get(jobs.OcrJob, row["id"])
        assert expired is None or expired.status == "FAILED" and expired.image_encrypted == ""
        assert db.get(jobs.OcrJob, new["id"]).status == "QUEUED"


def legacy_row(client, status="OCR_FAILED"):
    auth = login(client, "agent1")
    with DB() as db:
        agent = db.get(Agent, auth["user"]["agent_id"])
        image = base64.b64decode(photo())
        row = KycCapture(agent_id=agent.id, creator_id=agent.user_id, operation_id=str(uuid4()),
            source_reference="LEGACY-" + str(uuid4()), image_hash=hashlib.sha256(image).hexdigest(),
            image_type="image/png", image_encrypted=cipher.encrypt(image).decode(), status=status)
        captures.store(row, {"rows": [], "lines": [], "history": []})
        db.add(row)
        db.commit()
        return row.id, row.version


def test_legacy_retry_shares_admission_cap_with_stage_jobs(client):  # noqa: F811
    identifier, version = legacy_row(client)
    submit(client)
    submit(client)
    rejected = client.post(f"/api/kyc-captures/{identifier}/retry", json={"version": version})
    assert rejected.status_code == 429 and rejected.headers["retry-after"] == "2"
    with DB() as db:
        assert db.get(KycCapture, identifier).status == "OCR_FAILED"


def test_legacy_worker_uses_recoverable_lease_and_releases_checkout(client, monkeypatch):  # noqa: F811
    identifier, _ = legacy_row(client, "QUEUED")

    def extract(data):
        assert engine.pool.checkedout() == 0
        return {"lines": [{"text": "Legacy capture"}], "rows": [{"fields": [{"label": "Reference", "value": "legacy"}]}]}

    monkeypatch.setattr(captures.extractor, "extract", extract)
    assert captures.process_capture()
    with DB() as db:
        row = db.get(KycCapture, identifier)
        assert row.status == "EXTRACTED" and row.ocr_attempts == 1 and row.ocr_lease_token is None
        assert row.image_encrypted  # Historical evidence is permanent, unlike temporary stage jobs.


def test_older_synchronous_scanner_shares_global_worker_budget(client, monkeypatch):  # noqa: F811
    auth = login(client, "agent1")
    entered, release = Event(), Event()

    def extract(data):
        assert engine.pool.checkedout() == 0
        entered.set()
        assert release.wait(10)
        return {"lines": [{"text": "Customer details"}]}

    monkeypatch.setattr(jobs.extractor, "extract", extract)
    with ThreadPoolExecutor(max_workers=1) as executor:
        running = executor.submit(jobs.extract_compatibility, base64.b64decode(photo()), auth["user"]["id"])
        try:
            assert entered.wait(5)
            queued = submit(client)
            assert jobs.claim_job() is None
            denied = client.post("/api/kyc-captures/read-document", json={"image_base64": photo()})
            assert denied.status_code == 503 and denied.headers["retry-after"] == "2"
        finally:
            release.set()
        assert running.result(10)["lines"]
    assert jobs.claim_job()["id"] == queued["id"]
    with DB() as db:
        assert not db.scalar(select(jobs.OcrJob.id).where(jobs.OcrJob.stage == "SYNC"))
