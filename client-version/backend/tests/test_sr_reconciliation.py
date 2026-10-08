"""Business-critical SR reconciliation and optional-receipt workflow tests."""
# Shared pytest fixtures are intentionally imported by their injectable names.
# ruff: noqa: F811
import base64
import io
import hashlib
import json
from datetime import datetime
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import select, delete

from test_client_scope import client, database, login  # noqa: F401
from app import captures
from app.db import DB, Agent, User, SalesRecord, KycCapture, Audit, Customer, SalesCallTask, CallAttempt, Movement, Sim, Permission, now
from app.sr_verification import SrBatch, SrCheck, SrNotice
from app.email_delivery import EmailOutbox, deliver_pending


@pytest.fixture(autouse=True)
def cleanup(database):
    models = (EmailOutbox, SrNotice, SrCheck, SrBatch, CallAttempt, SalesCallTask, Movement, SalesRecord, KycCapture, Customer, Audit, Sim)
    with DB() as db:
        baseline = {model: set(db.scalars(select(model.id))) for model in models}
    yield
    with DB() as db:
        for model in models:
            db.execute(delete(model).where(model.id.not_in(baseline[model])))
        db.commit()


def make_sale(client, sr="SR-100", status="CLOSED", account="agent1"):
    login(client, account)
    agent_id = client.get("/api/auth/me").json()["agent_id"]
    response = client.post("/api/sales-management/sales", json={
        "agent_id": agent_id, "order_type": "NEW", "customer_name": "Synthetic SR Customer",
        "plan_name": "Captured plan", "sr_number": sr, "request_id": "SR-TEST-" + str(uuid4()),
    })
    assert response.status_code == 201, response.text
    identifier = response.json()["id"]
    with DB() as db:
        sale = db.get(SalesRecord, identifier)
        sale.created_at, sale.status = datetime(2026, 10, 7, 8), status
        db.commit()
    return identifier


def file_body(rows, **extra):
    return {"business_date": "2026-10-07", "filename": "daily-sr.csv",
            "content_base64": base64.b64encode(rows.encode()).decode(), **extra}


def apply_report(client, rows):
    login(client)
    body = file_body(rows)
    preview = client.post("/api/sales-management/sr/file", json=body)
    assert preview.status_code == 200, preview.text
    assert not preview.json()["errors"], preview.text
    result = client.post("/api/sales-management/sr/file", json={**body, "apply": True, "preview_token": preview.json()["preview_token"]})
    assert result.status_code == 200, result.text
    return result.json()


def test_sr_matching_is_independent_and_notifies_only_own_agent_and_saved_leader(client):
    match = make_sale(client, "SR-001")
    mismatch = make_sale(client, "SR-002")
    missing = make_sale(client, "")
    report = apply_report(client, "sr_number,status\nSR-001,CLOSED\nSR-999,CLOSED\n")
    assert report["summary"] == {"matched": 1, "mismatch": 1, "pending": 1}
    with DB() as db:
        assert all(db.get(SalesRecord, identifier).status == "CLOSED" for identifier in (match, mismatch, missing))
        sale = db.get(SalesRecord, mismatch)
        actor = db.get(Agent, sale.agent_id).user_id
        recipients = set(db.scalars(select(SrNotice.user_id).where(SrNotice.sale_id == mismatch)))
        assert recipients == {actor, sale.leader_id}
        assert db.scalar(select(SrCheck).where(SrCheck.sale_id == mismatch)).status == "MISMATCH"
        assert len(list(db.scalars(select(EmailOutbox).where(EmailOutbox.sale_id == mismatch)))) == 2
    for account in ("agent1", "leader"):
        login(client, account)
        notices = client.get("/api/notifications").json()["items"]
        assert any(item["title"] == "SR mismatch" and item["web_path"] == f"/sales?selected={mismatch}" for item in notices)
    login(client, "agent2")
    assert not any(item["id"].startswith("sr:") and item["web_path"] == f"/sales?selected={mismatch}" for item in client.get("/api/notifications").json()["items"])


def test_cancellation_reduces_original_day_from_fifteen_to_twelve(client):
    identifiers = [make_sale(client, f"SR-CANCEL-{number}") for number in range(15)]
    report = "sr_number,status\n" + "".join(f"SR-CANCEL-{number},{'CANCELLED' if number < 3 else 'CLOSED'}\n" for number in range(15))
    apply_report(client, report)
    response = client.get("/api/sales-management/performance?period=2026-10&from_date=2026-10-07&to_date=2026-10-07")
    assert response.status_code == 200
    summary = next(item for item in response.json()["daily_summary"] if item["date"] == "2026-10-07")
    assert summary["closed"] == 12 and summary["cancelled"] == 3 and summary["recorded"] == 15
    with DB() as db:
        assert sum(db.get(SalesRecord, identifier).status == "CANCELLED" for identifier in identifiers) == 3


def test_duplicate_report_is_atomic_and_reapply_does_not_duplicate_alerts(client):
    make_sale(client, "SR-ATOMIC")
    login(client)
    bad = file_body("sr_number\nSR-ATOMIC\nSR-ATOMIC\n", apply=True)
    assert client.post("/api/sales-management/sr/file", json=bad).status_code == 422
    with DB() as db:
        assert not list(db.scalars(select(SrBatch)))
    body = file_body("sr_number\nSR-MISSING\n")
    initial = apply_report(client, "sr_number\nSR-MISSING\n")
    with DB() as db:
        before = len(list(db.scalars(select(SrNotice)))), len(list(db.scalars(select(EmailOutbox))))
    duplicate = client.post("/api/sales-management/sr/file", json={**body, "apply": True})
    assert duplicate.status_code == 200 and duplicate.json()["already_applied"]
    assert duplicate.json()["batch_id"] == initial["batch_id"]
    with DB() as db:
        assert before == (len(list(db.scalars(select(SrNotice)))), len(list(db.scalars(select(EmailOutbox)))))


def test_same_report_reconciles_late_sales_then_remains_idempotent(client):
    first = make_sale(client, "SR-EARLY")
    report = "sr_number,status\nSR-EARLY,CLOSED\nSR-LATE,CLOSED\n"
    initial = apply_report(client, report)
    later = make_sale(client, "SR-LATE")
    login(client)
    body = file_body(report)
    preview = client.post("/api/sales-management/sr/file", json=body)
    assert preview.status_code == 200, preview.text
    assert not preview.json().get("already_applied")
    assert preview.json()["summary"] == {"matched": 2, "mismatch": 0, "pending": 0}
    result = client.post("/api/sales-management/sr/file", json={
        **body, "apply": True, "preview_token": preview.json()["preview_token"],
    })
    assert result.status_code == 200, result.text
    assert result.json()["batch_id"] != initial["batch_id"]
    with DB() as db:
        assert all(db.scalar(select(SrCheck).where(SrCheck.sale_id == identifier)).status == "MATCHED" for identifier in (first, later))
        notices = len(list(db.scalars(select(SrNotice))))
        batches = len(list(db.scalars(select(SrBatch))))
    duplicate = client.post("/api/sales-management/sr/file", json={**body, "apply": True})
    assert duplicate.status_code == 200 and duplicate.json()["already_applied"]
    with DB() as db:
        assert notices == len(list(db.scalars(select(SrNotice))))
        assert batches == len(list(db.scalars(select(SrBatch))))


def test_same_report_reconciles_corrected_sr_and_requires_fresh_preview(client):
    identifier = make_sale(client, "SR-WRONG")
    report = "sr_number,status\nSR-CORRECT,CLOSED\n"
    initial = apply_report(client, report)
    with DB() as db:
        sale = db.get(SalesRecord, identifier)
        sale.details = {**sale.details, "sr_number": "SR-CORRECT"}
        db.commit()
    login(client)
    body = file_body(report)
    assert client.post("/api/sales-management/sr/file", json={**body, "apply": True}).status_code == 409
    preview = client.post("/api/sales-management/sr/file", json=body).json()
    assert preview["summary"] == {"matched": 1, "mismatch": 0, "pending": 0}
    with DB() as db:
        sale = db.get(SalesRecord, identifier)
        sale.details = {**sale.details, "sr_number": "SR-CHANGED-AGAIN"}
        db.commit()
    assert client.post("/api/sales-management/sr/file", json={**body, "apply": True, "preview_token": preview["preview_token"]}).status_code == 409
    with DB() as db:
        sale = db.get(SalesRecord, identifier)
        sale.details = {**sale.details, "sr_number": "SR-CORRECT"}
        db.commit()
    checked = apply_report(client, report)
    assert checked["batch_id"] != initial["batch_id"]
    with DB() as db:
        assert db.scalar(select(SrCheck).where(SrCheck.sale_id == identifier)).status == "MATCHED"


def test_reuploading_an_earlier_report_reconciles_after_a_different_report(client):
    identifier = make_sale(client, "SR-RESTORED")
    original = "sr_number,status\nSR-RESTORED,CLOSED\n"
    first = apply_report(client, original)
    apply_report(client, "sr_number,status\nSR-OTHER,CLOSED\n")
    restored = apply_report(client, original)
    assert restored["batch_id"] != first["batch_id"]
    with DB() as db:
        assert db.scalar(select(SrCheck).where(SrCheck.sale_id == identifier)).status == "MATCHED"


def test_preview_rejects_stale_sales_and_does_not_cancel_on_failed_apply(client):
    identifier = make_sale(client, "SR-STALE")
    login(client)
    body = file_body("sr_number,status\nSR-STALE,CANCELLED\n")
    preview = client.post("/api/sales-management/sr/file", json=body).json()
    with DB() as db:
        db.get(SalesRecord, identifier).details = {"sr_number": "SR-CHANGED"}
        db.commit()
    assert client.post("/api/sales-management/sr/file", json={**body, "apply": True, "preview_token": preview["preview_token"]}).status_code == 409
    with DB() as db:
        assert db.get(SalesRecord, identifier).status == "CLOSED"
        assert not list(db.scalars(select(SrBatch)))


@pytest.mark.parametrize("account", ["agent1", "leader", "salesmanager", "tele", "welcome", "inventory"])
def test_sr_import_is_backend_only(client, account):
    login(client, account)
    assert client.post("/api/sales-management/sr/file", json=file_body("sr_number\nSR-100\n")).status_code == 403


@pytest.mark.parametrize("account", ["admin", "ops", "compliance"])
def test_sr_import_respects_restricted_backend_write_grants(client, account):
    login(client, account)
    user_id = client.get("/api/auth/me").json()["id"]
    with DB() as db:
        person = db.get(User, user_id)
        grant = db.scalar(select(Permission).where(Permission.role_id == person.role_id, Permission.name == "compliance.write"))
        assert grant is not None
        grant_id = grant.id
        grant.name = "audit-test-disabled-compliance-write"
        db.commit()
    try:
        assert client.get("/api/sales-management/sr/batches").status_code == 200
        assert client.post("/api/sales-management/sr/file", json=file_body("sr_number\nSR-100\n")).status_code == 403
        assert client.post("/api/sales-management/sr/file", json=file_body("sr_number\nSR-100\n", apply=True)).status_code == 403
    finally:
        with DB() as db:
            db.get(Permission, grant_id).name = "compliance.write"
            db.commit()


def test_duplicate_captured_sr_and_request_mismatch_are_not_false_matches(client):
    make_sale(client, "SR-DUP")
    make_sale(client, "SR-DUP")
    make_sale(client, "SR-REQUEST")
    result = apply_report(client, "sr_number,request_id\nSR-DUP,\nSR-REQUEST,WRONG\n")
    assert result["summary"]["matched"] == 0 and result["summary"]["mismatch"] == 3


def test_matching_report_does_not_bypass_independent_screenshot_review(client):
    identifier = make_sale(client, "SR-REVIEW", "IN_PROGRESS")
    with DB() as db:
        sale = db.get(SalesRecord, identifier)
        capture = KycCapture(agent_id=sale.agent_id, creator_id=db.get(Agent, sale.agent_id).user_id,
                             operation_id=str(uuid4()), source_reference="Synthetic pending review",
                             image_hash="test", image_type="image/png", image_encrypted=captures.cipher.encrypt(b"test").decode(), status="SUBMITTED", version=1)
        captures.store(capture, {"rows": [], "history": []})
        db.add(capture)
        db.flush()
        sale.capture_id = capture.id
        db.commit()
    apply_report(client, "sr_number,status\nSR-REVIEW,CLOSED\n")
    with DB() as db:
        assert db.get(SalesRecord, identifier).status == "IN_PROGRESS"
        assert db.scalar(select(SrCheck).where(SrCheck.sale_id == identifier)).status == "MATCHED"


@pytest.mark.parametrize("outcome", ["VERIFIED", "REJECTED"])
def test_review_does_not_revive_an_sr_cancelled_pending_sale(client, outcome):
    identifier = make_sale(client, "SR-CANCEL-REVIEW", "IN_PROGRESS")
    with DB() as db:
        sale = db.get(SalesRecord, identifier)
        agent = db.get(Agent, sale.agent_id)
        sim = Sim(iccid="CANCEL-REVIEW-" + str(uuid4()), serial="CANCEL-REVIEW-" + str(uuid4()),
                  sim_type="PHYSICAL", status="AVAILABLE", agent_id=agent.id, outlet_id=agent.outlet_id)
        db.add(sim)
        db.flush()
        sale.details = {**sale.details, "sim_serial": sim.serial}
        sim_id = sim.id
        capture = KycCapture(agent_id=sale.agent_id, creator_id=db.get(Agent, sale.agent_id).user_id,
                             operation_id=str(uuid4()), source_reference="Synthetic cancelled pending review",
                             image_hash="test", image_type="image/png", image_encrypted=captures.cipher.encrypt(b"test").decode(), status="SUBMITTED", version=1)
        captures.store(capture, {"document_kind": "SALE_SCREENSHOTS", "rows": [], "history": []})
        db.add(capture)
        db.flush()
        sale.capture_id = capture.id
        capture_id = capture.id
        db.commit()
    apply_report(client, "sr_number,status\nSR-CANCEL-REVIEW,CANCELLED\n")
    response = client.post(f"/api/kyc-captures/{capture_id}/review", json={
        "version": 1, "outcome": outcome, "reason": "Checked cancelled sale evidence",
    })
    assert response.status_code == (409 if outcome == "VERIFIED" else 200), response.text
    with DB() as db:
        sale = db.get(SalesRecord, identifier)
        capture = db.get(KycCapture, capture_id)
        assert sale.status == "CANCELLED"
        assert not sale.details.get("stock_deducted_sim_id")
        assert db.get(Sim, sim_id).status == "AVAILABLE"
        assert not list(db.scalars(select(Movement).where(Movement.sim_id == sim_id)))
        assert capture.status == ("SUBMITTED" if outcome == "VERIFIED" else "REJECTED")
        assert capture.version == (1 if outcome == "VERIFIED" else 2)


def test_mail_stays_queued_without_configuration_and_skips_evaluation_addresses(client, monkeypatch):
    make_sale(client, "SR-MAIL")
    apply_report(client, "sr_number\nSR-OTHER\n")
    monkeypatch.setenv("SMTP_ENABLED", "false")
    assert deliver_pending() == 0
    with DB() as db:
        assert all(item.status == "QUEUED" for item in db.scalars(select(EmailOutbox)))
    monkeypatch.setenv("SMTP_ENABLED", "true")
    monkeypatch.setenv("SMTP_HOST", "localhost")
    monkeypatch.setenv("SMTP_FROM", "relay@example.test")
    assert deliver_pending() == 0
    with DB() as db:
        assert all(item.status == "SKIPPED" and not item.sent_at for item in db.scalars(select(EmailOutbox)))


@pytest.mark.parametrize("scenario", ["accepted", "retry", "resolved", "email_changed", "inactive"])
def test_email_delivery_revalidates_recipient_and_resolved_state(client, monkeypatch, scenario):
    from app import email_delivery
    identifier = make_sale(client, "SR-DELIVERY")
    with DB() as db:
        person = db.get(User, db.get(Agent, db.get(SalesRecord, identifier).agent_id).user_id)
        previous = person.email
        user_id = person.id
        agent_id = db.get(SalesRecord, identifier).agent_id
        person.email = "synthetic.agent@relay.example.org"
        db.commit()
    delivered = []
    def transport(*args):
        if scenario == "retry":
            raise TimeoutError("Synthetic transport timeout")
        delivered.append(args)
    monkeypatch.setattr(email_delivery, "smtp_send", transport)
    monkeypatch.setenv("SMTP_ENABLED", "true")
    monkeypatch.setenv("SMTP_HOST", "localhost")
    monkeypatch.setenv("SMTP_FROM", "relay@example.test")
    try:
        apply_report(client, "sr_number\nOTHER\n")
        if scenario == "resolved":
            apply_report(client, "sr_number\nSR-DELIVERY\n")
        if scenario == "email_changed":
            with DB() as db:
                db.get(User, user_id).email = "replacement@relay.example.org"
                db.commit()
        if scenario == "inactive":
            with DB() as db:
                db.get(Agent, agent_id).employment_status = "LEFT"
                db.commit()
        assert deliver_pending() == (1 if scenario == "accepted" else 0)
        with DB() as db:
            message = db.scalar(select(EmailOutbox).where(EmailOutbox.user_id == user_id))
            assert message.status == {"accepted": "SENT", "retry": "RETRY", "resolved": "SKIPPED", "email_changed": "SKIPPED", "inactive": "SKIPPED"}[scenario]
            if scenario == "retry":
                assert message.attempts == 1 and message.next_attempt_at > now()
            if scenario == "accepted":
                assert message.sent_at and delivered[0][0] == "synthetic.agent@relay.example.org"
            else:
                assert not delivered
    finally:
        with DB() as db:
            db.get(User, user_id).email = previous
            db.get(Agent, agent_id).employment_status = "ACTIVE"
            db.commit()


def test_sr_excel_accepts_text_identifiers_and_rejects_formulas(client):
    from openpyxl import Workbook
    make_sale(client, "00000123")
    login(client)
    book = Workbook()
    book.active.append(["SR number", "Status"])
    book.active.append(["00000123", "CLOSED"])
    buffer = io.BytesIO()
    book.save(buffer)
    body = {**file_body(""), "filename": "daily.xlsx", "content_base64": base64.b64encode(buffer.getvalue()).decode()}
    result = client.post("/api/sales-management/sr/file", json=body)
    assert result.status_code == 200 and result.json()["summary"]["matched"] == 1
    book.active.cell(2, 1, '=HYPERLINK("https://example.invalid","00000123")')
    buffer = io.BytesIO()
    book.save(buffer)
    bad = client.post("/api/sales-management/sr/file", json={**body, "content_base64": base64.b64encode(buffer.getvalue()).decode()})
    assert bad.status_code == 200 and bad.json()["errors"]


def sale_intake(client, receipt=False):
    person = client.get("/api/auth/me").json()
    output = io.BytesIO()
    Image.new("RGB", (80, 80), "white").save(output, format="PNG")
    image = base64.b64encode(output.getvalue()).decode()
    intake = {"capture_mode": "SCREENSHOT_SALE", "transaction_id": str(uuid4()),
              "document_type": "Emirates ID", "name": "Synthetic Customer", "document_number": "SAMPLE-ID",
              "nationality": "Sample", "birth_date": "1990-01-01", "expiry_date": "2090-01-01",
              "document_image": image, "order_image": image, "order_reference": "SUBMIT-" + str(uuid4()),
              "order_type": "NEW", "msisdn": "0500000000", "package_name": "Captured package",
              "plan_id": client.get("/api/resources/plans").json()[0]["id"], "step": 2}
    intake["document_check"] = captures.document_check(image, intake, person["id"])
    intake["order_check"] = captures.cipher.encrypt(json.dumps({
        "image": hashlib.sha256(output.getvalue()).hexdigest(),
        "fields": {key: intake[key] for key in captures.ORDER_KEYS},
        "user": person["id"], "expires": now().timestamp() + 86400,
    }).encode()).decode()
    if receipt:
        intake["payment_image"] = image
    return {"agent_id": person["agent_id"], "operation_id": str(uuid4()), "intake": intake}


@pytest.mark.parametrize("receipt", [False, True])
def test_sale_submit_has_no_payment_gate_and_preserves_receipt_and_sr_states(client, receipt):
    login(client, "agent1")
    body = sale_intake(client, receipt)
    response = client.post("/api/kyc-captures/sale-submissions", json=body)
    assert response.status_code == 201, response.text
    record = response.json()
    assert record["status"] == "SUBMITTED" and record["document_kind"] == "SALE_SCREENSHOTS"
    assert record["payment_record_status"] == ("RECORDED" if receipt else "NOT_RECORDED")
    assert record["sr_verification"]["status"] == "PENDING_SR_VERIFICATION"
    assert record["invoice"]["heading"] == "Sale submitted"
    replay = client.post("/api/kyc-captures/sale-submissions", json=body)
    assert replay.status_code == 201 and replay.json()["id"] == record["id"]
    changed = {**body, "intake": {**body["intake"], "nationality": "Different"}}
    assert client.post("/api/kyc-captures/sale-submissions", json=changed).status_code == 409
    login(client)
    reviewed = client.post(f"/api/kyc-captures/{record['id']}/review", json={"version": record["version"], "outcome": "VERIFIED", "reason": "Compared customer and order screenshots"})
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["sr_verification"]["status"] == "PENDING_SR_VERIFICATION"
    assert reviewed.json()["sr_verification"]["sale_status"] == "CLOSED"


def test_current_capture_requires_actual_bound_images_and_explicit_hw_choice(client):
    login(client, "agent1")
    body = sale_intake(client)
    body["intake"]["document_check"] = ""
    assert client.post("/api/kyc-captures/sale-submissions", json=body).status_code == 422
    body = sale_intake(client)
    body["intake"].update(order_type="HW", router_fulfilment="")
    assert client.post("/api/kyc-captures/sale-submissions", json=body).status_code == 422
    body["intake"]["router_fulfilment"] = "WITHOUT_ROUTER"
    assert client.post("/api/kyc-captures/sale-submissions", json=body).status_code == 201
