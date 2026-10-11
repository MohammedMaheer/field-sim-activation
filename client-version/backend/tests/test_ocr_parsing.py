"""Recognition ambiguity and evidence integrity; no carrier/authenticity claims."""
import base64
import io
import json
from types import SimpleNamespace
import pytest
from PIL import Image
from fastapi import HTTPException
from test_client_scope import client, database, login  # noqa: F401
from app import captures
from app.capture_ocr import organize_lines


def photo():
    out = io.BytesIO()
    Image.new('RGB', (90, 90), 'white').save(out, 'PNG')
    return base64.b64encode(out.getvalue()).decode()


def result(texts, confidence=96):
    lines = [{'text': text, 'confidence': confidence} for text in texts]
    return {'lines': lines, 'rows': organize_lines(lines)}


def customer(extra=(), confidence=96):
    return result(['Customer Details', 'Full name: Sample Customer', 'Document Number: 784-1990-1234567-1',
                   'Date of birth: 01-Jan-1990', 'Expiry date: 31-Dec-2090', *extra], confidence)


@pytest.mark.parametrize('extra', [
    ['Document Number: 784-1990-7654321-2'],
    ['Second number 784-1990-7654321-2'],
    ['Other numbers 784-1990-1234567-1 784-1990-7654321-2'],
])
def test_conflicting_explicit_and_fallback_ids_do_not_issue_document_proof(extra):
    parsed = captures.parse_document_result(customer(extra), photo(), 'user-a')
    assert 'document_number' not in parsed and 'document_check' not in parsed
    assert parsed['_ocr']['warnings'] and parsed['_ocr']['lines']


def test_equivalent_dashed_and_undashed_identity_values_are_not_conflicts():
    parsed = captures.parse_document_result(customer(['784199012345671']), photo(), 'user-a')
    assert parsed['document_check'] and not parsed['_ocr']['warnings']


def test_low_confidence_required_identity_is_not_certified():
    extracted = customer()
    extracted['lines'][2]['confidence'] = 0
    parsed = captures.parse_document_result(extracted, photo(), 'user-a')
    assert 'document_number' not in parsed and 'document_check' not in parsed
    assert any('clearer' in warning for warning in parsed['_ocr']['warnings'])


def test_next_label_is_not_used_as_value_and_order_conflicts_do_not_issue_proof(database):  # noqa: F811
    with captures.DB() as db:
        extracted = result(['Order Details', 'Product Name', 'Package Name: 5G Unlimited Ultra',
                            'MSISDN: 0501234567', 'Request ID: REQ-12345', 'Request ID: REQ-99999'])
        parsed = captures.parse_order_result(extracted, photo(), 'user-a', db)
    assert 'product_name' not in parsed and 'order_reference' not in parsed
    assert 'order_check' not in parsed and parsed['order_fields']
    assert any('Conflicting' in message for message in parsed['_ocr']['warnings'])


def test_recognized_supporting_identity_values_are_bound_but_absent_fields_remain_manual():
    image = photo()
    parsed = captures.parse_document_result(customer(['Nationality: Sample Nation']), image, 'user-a')
    intake = captures.Intake(**parsed, document_image=image)
    captures.check_document_evidence(intake, SimpleNamespace(id='user-a'))
    intake.nationality = 'Different Nation'
    with pytest.raises(HTTPException):
        captures.check_document_evidence(intake, SimpleNamespace(id='user-a'))
    missing = captures.parse_document_result(customer(), image, 'user-a')
    manual = captures.Intake(**missing, document_image=image, nationality='Manually recorded')
    captures.check_document_evidence(manual, SimpleNamespace(id='user-a'))
    # Historical proofs keep their original four-field behavior.
    proof = json.loads(captures.cipher.decrypt(parsed['document_check'].encode()))
    proof.pop('version')
    proof['fields'] = {key: proof['fields'][key] for key in captures.DOCUMENT_KEYS}
    intake.document_check = captures.cipher.encrypt(json.dumps(proof).encode()).decode()
    captures.check_document_evidence(intake, SimpleNamespace(id='user-a'))


def test_recognized_package_and_charges_cannot_change_after_order_read(database):  # noqa: F811
    image = photo()
    with captures.DB() as db:
        parsed = captures.parse_order_result(result(['Order Details', 'Package Name: Unlisted printed package',
            'Request ID: REQ-12345', 'MSISDN: 0501234567', 'Basic Plan: AED 325 Monthly - AED 0 Prepayment']), image, 'user-a', db)
    assert parsed['order_check'] and 'plan_id' not in parsed
    intake = captures.Intake(**parsed, order_image=image, capture_mode='SCREENSHOT_SALE')
    captures.check_order_evidence(intake, SimpleNamespace(id='user-a'))
    intake.monthly_cost = '3250'
    with pytest.raises(HTTPException):
        captures.check_order_evidence(intake, SimpleNamespace(id='user-a'))


def test_receipt_low_confidence_or_conflicting_sr_keeps_raw_text_without_sr_proof():
    for extracted in [result(['SR Number: SR-12345'], 12), result(['SR Number: SR-12345', 'SR Number: SR-98765'])]:
        parsed = captures.parse_receipt_result(extracted, photo(), 'user-a')
        assert not parsed['fields'] and not parsed['sr_check']
        assert parsed['lines'] and parsed['_ocr']['warnings']


def test_invalid_passport_check_digits_do_not_autofill_or_issue_proof():
    parsed = captures.parse_document_result(result(['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
        'L898902C36UTO7408122F3004159<<<<<<<<<<<<<<04']), photo(), 'user-a')
    assert 'document_check' not in parsed and 'document_number' not in parsed
    assert parsed['_ocr']['warnings']


def test_synchronous_ocr_releases_request_db_checkout_before_extracting(client, monkeypatch):  # noqa: F811
    from app.db import engine
    login(client, 'agent1')
    def recognize(data):
        assert engine.pool.checkedout() == 0
        return customer()
    monkeypatch.setattr(captures.extractor, 'extract', recognize)
    read = client.post('/api/kyc-captures/read-document', json={'image_base64': photo()})
    assert read.status_code == 200 and read.json()['document_check']


def test_receipt_attachment_bound_matches_the_four_mb_upload_contract():
    from pydantic import ValidationError
    import random
    # A real photo larger than the previous 1 MB base64 limit must be accepted;
    # arbitrary padding is rightly rejected by the image safety validator.
    image = Image.frombytes('RGB', (700, 500), random.Random(76).randbytes(700 * 500 * 3))
    stream = io.BytesIO()
    image.save(stream, 'PNG')
    encoded = base64.b64encode(stream.getvalue()).decode()
    assert 1_000_000 < len(encoded) < 5_333_336
    assert captures.Intake(payment_image=encoded).payment_image == encoded
    assert captures.Intake.model_json_schema()['properties']['payment_image']['maxLength'] == 5_333_336
    with pytest.raises(ValidationError):
        captures.Intake(payment_image='a' * 5_333_337)
