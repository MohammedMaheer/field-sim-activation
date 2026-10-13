"""Receipt exports preserve complete paper details, current states and access scope."""
import io
from datetime import datetime
from uuid import uuid4

from pypdf import PdfReader
from sqlalchemy import select

import test_client_scope as shared
from test_capture_identity import sale_body, submit, new_records  # noqa: F401 - imported autouse cleanup fixture
from app.db import DB, KycCapture, SalesRecord, Role, Permission, User

client, database, login = shared.client, shared.database, shared.login


def test_sale_receipt_is_branded_compact_complete_and_private(client):
    body = sale_body(client)
    body["intake"].update(monthly_cost="325", prepayment="0", arabic_name="اسم العميل")
    submitted = submit(client, body)
    assert submitted.status_code == 201, submitted.text
    response = client.get(f"/api/kyc-captures/{submitted.json()['id']}/receipt")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/pdf")
    assert "qanawat-reference-bill-" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    reader = PdfReader(io.BytesIO(response.content))
    text = " ".join(page.extract_text() for page in reader.pages)
    assert len(reader.pages) <= 2
    assert "Qanawat Connect Solutions LLC" in text
    for value in ("REFERENCE BILL", "Same customer", "Monthly charge", "325", "Prepayment on order", "0",
                  "Nationality", "Order details screen", "Not recorded", "SR verification"):
        assert value in text
    assert body["intake"]["order_reference"] in "".join(text.split())
    assert body["intake"]["document_number"] not in text
    assert "**** 5671" in text
    assert "Total paid" not in text and "Payment successful" not in text
    assert any("/XObject" in page["/Resources"] for page in reader.pages)
    login(client, "agent2")
    assert client.get(f"/api/kyc-captures/{submitted.json()['id']}/receipt").status_code == 404


def test_sale_receipt_follows_authoritative_cancellation_state(client):
    submitted = submit(client, sale_body(client)).json()
    with DB() as db:
        capture = db.get(KycCapture, submitted["id"])
        capture.status = "VERIFIED"
        sale = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == capture.id))
        sale.status = "CANCELLED"
        db.commit()
    response = client.get(f"/api/kyc-captures/{submitted['id']}/receipt")
    assert response.status_code == 200
    text = " ".join(page.extract_text() for page in PdfReader(io.BytesIO(response.content)).pages)
    assert "Cancelled" in text
    assert "Fully activated" not in text


def test_new_reference_bill_places_sr_once_with_primary_sale_details(client):
    sr = 'SR-BILL-' + uuid4().hex
    submitted = submit(client, sale_body(client, sr=sr)).json()
    response = client.get(f"/api/kyc-captures/{submitted['id']}/print-data")
    assert response.status_code == 200
    sections = response.json()['invoice']['sections']
    first = sections[0]
    assert first['title'] == 'Reference details'
    assert first['fields'][3]['label'] == 'Activation'
    assert {'label': 'SR number', 'value': sr} in first['fields']
    assert len([field for section in sections for field in section['fields'] if field['label'] == 'SR number']) == 1


def test_historical_order_reference_bill_keeps_original_sr_section():
    from types import SimpleNamespace
    from app.invoices import invoice
    row = SimpleNamespace(id='historical-order', status='VERIFIED', created_at=datetime(2026, 10, 1))
    data = {'intake': {'capture_mode': 'SCREENSHOT_ORDER', 'sr_number': 'SR-HISTORICAL-1234'}, 'rows': []}
    sections = invoice(row, data)['sections']
    assert not any(field['label'] == 'SR number' for field in sections[0]['fields'])
    plan = next(section for section in sections if section['title'] == 'SIM & plan')
    assert {'label': 'SR number', 'value': 'SR-HISTORICAL-1234'} in plan['fields']


def test_print_preparation_rechecks_effective_export_permission_and_scope(client):
    submitted = submit(client, sale_body(client)).json()
    from app.sr_verification import SrBatch, SrCheck
    with DB() as db:
        sale = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == submitted['id']))
        admin_id = db.scalar(select(User.id).where(User.email == 'admin@relay.demo'))
        batch = SrBatch(business_date='2026-10-11', fingerprint=str(uuid4()), filename='synthetic.xlsx', actor_id=admin_id, report_encrypted='synthetic', summary={})
        db.add(batch)
        db.flush()
        db.add(SrCheck(sale_id=sale.id, status='MATCHED', business_date='2026-10-11', batch_id=batch.id, verified_at=datetime(2026, 10, 11, 8)))
        db.commit()
    url = f"/api/kyc-captures/{submitted['id']}/print-data"
    response = client.get(url)
    assert response.status_code == 200 and 'no-store' in response.headers['cache-control']
    assert response.json()['invoice']['sections'][0]['title'] == 'Reference details'
    assert response.json()['invoice']['sr_verification']['verified_at'] == '2026-10-11T08:00:00'
    assert 'images' not in response.json() and 'lines' not in response.json()
    login(client, 'agent2')
    assert client.get(url).status_code == 404
    login(client)
    with DB() as db:
        role_id = db.scalar(select(Role.id).where(Role.name == 'Administrator'))
        grant = db.scalar(select(Permission).where(Permission.role_id == role_id, Permission.name == 'report.read'))
        grant_id = grant.id
        db.delete(grant)
        db.commit()
    try:
        assert client.get(url).status_code == 403
        assert client.get(url.replace('/print-data', '/receipt')).status_code == 403
    finally:
        with DB() as db:
            db.add(Permission(id=grant_id, role_id=role_id, name='report.read'))
            db.commit()
