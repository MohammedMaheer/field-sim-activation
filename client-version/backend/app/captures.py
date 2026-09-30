"""Encrypted capture, review and export workflow shared by both editions."""

import base64
import hashlib
import io
import json
import re
import uuid
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, func, and_, or_
from sqlalchemy.exc import IntegrityError
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from .db import (
    KycCapture,
    CaptureDraft,
    SavedCaptureDraft,
    SimProgress,
    Plan,
    DB,
    User,
    Customer,
    Order,
    Activation,
    OrderEvent,
    Sim,
    Agent,
    Role,
    Notification,
    Movement,
    SalesRecord,
    get_db,
    now,
)
from .security import principal, permissions, require, assert_agent, visible_agents, cipher
from .services import audit
from .invoices import invoice
from .capture_ocr import extractor, inspect_image

router = APIRouter(prefix="/api/kyc-captures", tags=["KYC transaction captures"])
SAMPLE_REFERENCE_PREFIXES = (
    "DEMO-REVIEW-%",
    "DEMO-WEB-%",
    "PAY-REVIEW-%",
    "PAY-INVOICE-%",
    "PAY-QA-%",
)


def access(db, user, write=False):
    require(db, user, "read")
    allowed = {"activation.write", "ekyc.write"}
    if not write:
        allowed.add("compliance.write")
    if not permissions(db, user) & allowed:
        raise HTTPException(403, "Your role cannot access transaction captures")


def payload(row):
    return (
        json.loads(cipher.decrypt(row.payload_encrypted.encode()))
        if row.payload_encrypted
        else {"rows": [], "lines": [], "history": []}
    )


def store(row, data):
    row.payload_encrypted = cipher.encrypt(json.dumps(data, ensure_ascii=False).encode()).decode()


def view(row, detail=True):
    result = {
        "id": row.id,
        "agent_id": row.agent_id,
        "creator_id": row.creator_id,
        "source_reference": row.source_reference,
        "status": row.status,
        "version": row.version,
        "image_type": row.image_type,
        "image_hash": row.image_hash,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "error": row.error,
    }
    content = payload(row)
    result["document_kind"] = content.get("document_kind", "ACTIVATION_RECEIPT")
    result["activation"] = content.get("activation")
    if detail:
        result.update(content)
        if result["document_kind"] == "PAYMENT_CONFIRMATION":
            result["invoice"] = invoice(row, content)
    return result


def capture_scope(db, user):
    current = KycCapture.agent_id.in_(visible_agents(db, user))
    if db.get(Role, user.role_id).name == "Team Leader":
        linked = select(SalesRecord.id).where(SalesRecord.capture_id == KycCapture.id)
        return or_(linked.where(SalesRecord.leader_id == user.id).exists(),
                   and_(~linked.exists(), current))
    return current


def get_capture(db, user, capture_id, lock=False):
    access(db, user)
    q = select(KycCapture).where(KycCapture.id == capture_id, capture_scope(db, user))
    row = db.scalar(q.with_for_update() if lock else q)
    if not row:
        raise HTTPException(404, "Capture not found")
    return row


def record(db, row, user, action, request=None, data=None):
    data = data if data is not None else payload(row)
    data.setdefault("history", []).append(
        {"action": action, "actor": user.name, "at": now().isoformat(), "status": row.status}
    )
    store(row, data)
    row.version += 1
    row.updated_at = now()
    audit(
        db,
        user,
        action,
        row.id,
        row.agent_id,
        new={"status": row.status, "version": row.version},
        request=request,
    )


class Intake(BaseModel):
    capture_mode: Literal["LEGACY", "SCREENSHOT_ORDER"] = "LEGACY"
    transaction_id: str = Field(default="", max_length=80)
    saved_draft_id: str = Field(default="", max_length=36)
    document_type: Literal["National ID", "Passport"] = "National ID"
    name: str = Field(default="", max_length=120)
    arabic_name: str = Field(default="", max_length=160)
    gender: str = Field(default="", max_length=30)
    issue_date: str = Field(default="", max_length=10)
    document_number: str = Field(default="", max_length=80)
    nationality: str = Field(default="", max_length=80)
    birth_date: str = Field(default="", max_length=10)
    expiry_date: str = Field(default="", max_length=10)
    document_image: str = Field(default="", max_length=1_333_336)
    document_check: str = Field(default="", max_length=8192)
    order_image: str = Field(default="", max_length=1_333_336)
    order_check: str = Field(default="", max_length=8192)
    order_reference: str = Field(default="", max_length=120)
    product_name: str = Field(default="", max_length=160)
    package_name: str = Field(default="", max_length=160)
    monthly_cost: str = Field(default="", max_length=80)
    prepayment: str = Field(default="", max_length=80)
    order_type: Literal["UNSPECIFIED", "NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR"] = "UNSPECIFIED"
    account_number: str = Field(default="", max_length=120)
    router_serial: str = Field(default="", max_length=100)
    advance_transaction_number: str = Field(default="", max_length=120)
    sr_number: str = Field(default="", max_length=120)
    alternate_number: str = Field(default="", max_length=40)
    order_fields: list[dict[str, str]] = Field(default_factory=list, max_length=100)
    selfie_image: str = Field(default="", max_length=1_333_336)
    sim_type: Literal["PHYSICAL", "ESIM"] = "PHYSICAL"
    sim_identifier: str = Field(default="", max_length=100)
    plan_id: str = Field(default="", max_length=100)
    plan_name: str = Field(default="", max_length=160)
    msisdn: str = Field(default="", max_length=40)
    signature: list[list[tuple[float, float]]] = Field(default_factory=list, max_length=100)
    kiosk_reference: str = Field(default="", max_length=120)
    payment_image: str = Field(default="", max_length=1_333_336)
    payment_on_receipt: bool = False
    step: int = Field(default=0, ge=0, le=2)

    @model_validator(mode="after")
    def safe_data(self):
        import math

        if any(
            set(item) != {"label", "value"} or len(item["label"]) > 120 or len(item["value"]) > 1000
            for item in self.order_fields
        ):
            raise ValueError("Invalid order fields")

        if sum(len(stroke) for stroke in self.signature) > 3000 or any(
            not math.isfinite(n) or n < 0 or n > 1
            for stroke in self.signature
            for point in stroke
            for n in point
        ):
            raise ValueError("Invalid signature")
        for image in [self.document_image, self.order_image, self.selfie_image, self.payment_image]:
            if image:
                inspect_image(base64.b64decode(image, validate=True))
        from datetime import date

        for value in [self.birth_date, self.expiry_date]:
            if value:
                date.fromisoformat(value)
        return self

    def complete(self):
        from datetime import date

        required = [
            self.name,
            self.document_number,
            self.nationality,
            self.birth_date,
            self.expiry_date,
            self.document_image,
            self.plan_id,
            self.msisdn,
        ]
        if self.capture_mode == "SCREENSHOT_ORDER":
            required.extend([self.order_image, self.order_reference])
            if self.order_type == "HW" and not self.router_serial.strip():
                raise HTTPException(422, "Router serial is required for home wireless sales")
        else:
            required.append(self.sim_identifier)
        if not all(v.strip() for v in required) or (
            self.capture_mode == "LEGACY" and sum(len(s) for s in self.signature) < 8
        ):
            raise HTTPException(422, "Complete customer details and order before payment")
        if (
            date.fromisoformat(self.expiry_date) < date.today()
            or date.fromisoformat(self.birth_date) >= date.today()
        ):
            raise HTTPException(422, "Check the document expiry and date of birth")


DOCUMENT_KEYS = ("name", "document_number", "birth_date", "expiry_date")


def document_check(image, fields, user_id):
    """Bind readable printed identity details to this exact image and account.

    This checks readability and consistency, not document authenticity.
    """
    return cipher.encrypt(
        json.dumps(
            {
                "image": hashlib.sha256(base64.b64decode(image, validate=True)).hexdigest(),
                "fields": {key: fields[key] for key in DOCUMENT_KEYS},
                "user": user_id,
                "expires": now().timestamp() + 30 * 86400,
            }
        ).encode()
    ).decode()


def check_document_evidence(intake, user):
    try:
        proof = json.loads(cipher.decrypt(intake.document_check.encode()))

        def normalize(value):
            return re.sub(r"[^\w]", "", str(value)).casefold()

        valid = (
            proof["user"] == user.id
            and proof["expires"] >= now().timestamp()
            and proof["image"]
            == hashlib.sha256(base64.b64decode(intake.document_image, validate=True)).hexdigest()
            and all(
                normalize(proof["fields"][key]) == normalize(getattr(intake, key))
                for key in DOCUMENT_KEYS
            )
        )
        if valid:
            return
    except Exception:
        pass
    raise HTTPException(
        422, "Document wasn't captured clearly. Scan or upload your ID or passport again."
    )


ORDER_KEYS = ("order_reference", "msisdn")


def check_order_evidence(intake, user):
    if intake.capture_mode != "SCREENSHOT_ORDER":
        return
    try:
        proof = json.loads(cipher.decrypt(intake.order_check.encode()))

        def normalize(value):
            return re.sub(r"[^\w]", "", str(value)).casefold()

        valid = (
            proof["user"] == user.id
            and proof["expires"] >= now().timestamp()
            and proof["image"]
            == hashlib.sha256(base64.b64decode(intake.order_image, validate=True)).hexdigest()
            and all(
                normalize(proof["fields"][key]) == normalize(getattr(intake, key))
                for key in ORDER_KEYS
            )
        )
        if valid:
            return
    except Exception:
        pass
    raise HTTPException(422, "Order details weren't captured clearly. Scan the order screen again.")


class IntakeDraftBody(BaseModel):
    version: int = Field(ge=0)
    data: Intake


@router.get("/draft")
def read_draft(user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    row = db.scalar(select(CaptureDraft).where(CaptureDraft.creator_id == user.id))
    return {"version": row.version, "data": payload(row)} if row else {"version": 0, "data": {}}


@router.put("/draft")
def save_draft(body: IntakeDraftBody, user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    if body.data.step > 0:
        check_document_evidence(body.data, user)
    if body.data.step > 1:
        check_order_evidence(body.data, user)
    # Serialize first creation as well as updates for the same user.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    row = db.scalar(
        select(CaptureDraft).where(CaptureDraft.creator_id == user.id).with_for_update()
    )
    if (row.version if row else 0) != body.version:
        raise HTTPException(409, "Your draft changed on another device. Reload before continuing.")
    if row is None:
        row = CaptureDraft(creator_id=user.id, version=0)
        db.add(row)
    row.version += 1
    store(row, body.data.model_dump(mode="json"))
    db.commit()
    return {"version": row.version, "data": payload(row)}


class SavedDraftBody(BaseModel):
    data: Intake


@router.get("/saved-drafts")
def saved_drafts(user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    return [
        {"id": row.id, "created_at": row.created_at, "data": payload(row)}
        for row in db.scalars(
            select(SavedCaptureDraft)
            .where(SavedCaptureDraft.creator_id == user.id)
            .order_by(SavedCaptureDraft.created_at.desc())
        )
    ]


@router.post("/saved-drafts", status_code=201)
def save_named_draft(body: SavedDraftBody, user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    if body.data.step > 0:
        check_document_evidence(body.data, user)
    if body.data.step > 1:
        check_order_evidence(body.data, user)
    row = db.get(SavedCaptureDraft, body.data.saved_draft_id) if body.data.saved_draft_id else None
    if row and row.creator_id != user.id:
        raise HTTPException(404, "Draft not found")
    if row is None:
        count = db.scalar(
            select(func.count())
            .select_from(SavedCaptureDraft)
            .where(SavedCaptureDraft.creator_id == user.id)
        )
        if count >= 20:
            raise HTTPException(
                409, "Keep up to 20 drafts. Complete or discard an existing draft first."
            )
        row = SavedCaptureDraft(id=str(uuid.uuid4()), creator_id=user.id)
        db.add(row)
    content = body.data.model_dump(mode="json")
    content["saved_draft_id"] = row.id
    store(row, content)
    db.commit()
    return {"id": row.id, "data": content}


@router.delete("/saved-drafts/{draft_id}")
def discard_named_draft(draft_id: str, user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    row = db.get(SavedCaptureDraft, draft_id)
    if row is None or row.creator_id != user.id:
        raise HTTPException(404, "Draft not found")
    transaction_id = payload(row).get("transaction_id")
    for progress in db.scalars(
        select(SimProgress).where(SimProgress.transaction_id == transaction_id).with_for_update()
    ):
        if not progress.capture_id:
            assert_agent(db, user, progress.agent_id)
            db.delete(progress)
    db.delete(row)
    db.commit()
    return {"discarded": True}


class IdentityImage(BaseModel):
    image_base64: str = Field(max_length=1_333_336)


@router.post("/read-document")
def read_document(body: IdentityImage, user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    try:
        result = extractor.extract(base64.b64decode(body.image_base64, validate=True))
    except Exception:
        raise HTTPException(
            422, "Document wasn't captured clearly. Use a clearer ID or passport photo."
        )
    aliases = {
        "full name": "name",
        "full legal name": "name",
        "name": "name",
        "customer name": "name",
        "nationality": "nationality",
        "document number": "document_number",
        "id number": "document_number",
        "identity number": "document_number",
        "id no": "document_number",
        "passport no": "document_number",
        "passport number": "document_number",
        "date of birth": "birth_date",
        "expiry date": "expiry_date",
        "date of expiry": "expiry_date",
        "issue date": "issue_date",
        "sex": "gender",
        "gender": "gender",
        "arabic name": "arabic_name",
        "document expiry date": "expiry_date",
    }
    fields = {}
    lines = [str(line.get("text", "")).strip() for line in result.get("lines", [])]
    labels = sorted(aliases, key=len, reverse=True)
    for index, text in enumerate(lines):
        label, sep, value = text.partition(":")
        key = aliases.get(label.strip().lower()) if sep else None
        if not key:
            for candidate in labels:
                match = re.match(rf"^{re.escape(candidate)}\s*[-–:]?\s+(.+)$", text, re.I)
                if match:
                    key, value = aliases[candidate], match.group(1)
                    break
        if not key and text.lower() in aliases and index + 1 < len(lines):
            key, value = aliases[text.lower()], lines[index + 1]
        if key and value.strip():
            value = value.strip()
            if key.endswith("date"):
                parsed = None
                for fmt in (
                    "%Y-%m-%d",
                    "%d/%m/%Y",
                    "%d-%m-%Y",
                    "%d-%b-%Y",
                    "%d-%B-%Y",
                    "%d %b %Y",
                    "%d %B %Y",
                ):
                    try:
                        parsed = datetime.strptime(value, fmt).date().isoformat()
                        break
                    except ValueError:
                        pass
                if not parsed:
                    continue
                value = parsed
            fields[key] = value[: 80 if key in {"document_number", "nationality"} else 120]
        if "document_number" not in fields:
            emirates_id = re.search(r"\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b", text)
            if emirates_id:
                fields["document_number"] = emirates_id.group().replace(" ", "")
    # Passport machine-readable zones contain the printed name and number.
    if "name" not in fields:
        for index, text in enumerate(lines):
            if not re.search(r"customer\s+details", text, re.I):
                continue
            candidates = []
            for next_line in lines[index + 1 : index + 5]:
                if re.search(r"document\s+type|document\s+number", next_line, re.I):
                    break
                if re.fullmatch(r"[A-Z][A-Z .'-]{3,}", next_line):
                    candidates.append(next_line)
            if candidates:
                fields["name"] = " ".join(candidates)[:120]
            break
    for index, text in enumerate(lines[:-1]):
        if not re.match(r"^P<[A-Z<]{3,}$", text):
            continue
        zone = text.upper()
        name_part = zone[5:].split("<<")
        if len(name_part) > 1 and "name" not in fields:
            fields["name"] = " ".join(
                part.replace("<", " ").strip() for part in [name_part[1], name_part[0]] if part
            ).strip()
        next_line = lines[index + 1].upper()
        if re.match(r"^[A-Z0-9<]{9}[0-9]", next_line) and "document_number" not in fields:
            fields["document_number"] = next_line[:9].replace("<", "")
        if len(next_line) >= 28:
            for key, part in (("birth_date", next_line[13:19]), ("expiry_date", next_line[21:27])):
                if key in fields or not re.fullmatch(r"\d{6}", part):
                    continue
                year = int(part[:2])
                year += 1900 if key == "birth_date" and year > datetime.now().year % 100 else 2000
                try:
                    fields[key] = (
                        datetime.strptime(f"{year}{part[2:]}", "%Y%m%d").date().isoformat()
                    )
                except ValueError:
                    pass
        break
    identity_text = " ".join(lines).lower()
    identity_context = bool(
        re.search(
            r"identity\s+(?:document|card|number)|emirates\s+id|passport|resident\s+card|national\s+id|document\s+(?:type|number)|customer\s+details|^p<",
            identity_text,
        )
    ) or any(re.search(r"\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b", line) for line in lines)
    if re.search(r"document\s+type\s*:\s*passport", identity_text):
        fields["document_type"] = "Passport"
    elif re.search(r"document\s+type\s*:\s*(?:uae\s+)?identity", identity_text):
        fields["document_type"] = "National ID"
    if identity_context and all(fields.get(key) for key in DOCUMENT_KEYS):
        fields["document_check"] = document_check(body.image_base64, fields, user.id)
    return fields


def order_fields(lines):
    labels = {
        "request id": "order_reference",
        "request number": "order_reference",
        "order id": "order_reference",
        "msisdn": "msisdn",
        "phone number": "msisdn",
        "mobile number": "msisdn",
        "product name": "product_name",
        "package name": "package_name",
        "account number": "account_number",
        "account no": "account_number",
        "sim serial number": "sim_identifier",
        "iccid": "sim_identifier",
        "router serial number": "router_serial",
        "router serial": "router_serial",
        "advance payment transaction number": "advance_transaction_number",
        "sr number": "sr_number",
        "service request number": "sr_number",
        "order type": "order_type",
    }
    values = {}
    texts = [str(line.get("text", "")).strip() for line in lines]
    for index, text in enumerate(texts):
        for label, key in labels.items():
            match = re.match(rf"^{re.escape(label)}\s*[:：-]?\s*(.*)$", text, re.I)
            if not match:
                continue
            value = match.group(1).strip()
            if not value and index + 1 < len(texts):
                value = texts[index + 1]
            if value and value.casefold() not in labels:
                values[key] = value[:160]
            break
        if re.search(r"(?:basic\s+plan|grand\s+total|monthly)", text, re.I):
            cost = re.search(r"(?:AED\s*)?(\d+(?:\.\d{1,2})?)\s*(?:AED\s*)?monthly", text, re.I)
            advance = re.search(
                r"(?:AED\s*)?(\d+(?:\.\d{1,2})?)\s*(?:AED\s*)?prepayment", text, re.I
            )
            if cost:
                values["monthly_cost"] = cost.group(1)
            if advance:
                values["prepayment"] = advance.group(1)
    if not re.fullmatch(r"[+\d][\d\s-]{7,19}", values.get("msisdn", "")):
        values.pop("msisdn", None)
    reference = values.get("order_reference", "")
    # Recognition can split an explicitly labelled numeric identifier into groups.
    # Do not turn arbitrary words or an absent identifier into a request ID.
    if re.fullmatch(r"[\w-]*\d(?:\s+\d+)+", reference):
        values["order_reference"] = re.sub(r"\s+", "", reference)
    if not re.fullmatch(r"[\w-]{5,80}", values.get("order_reference", "")):
        values.pop("order_reference", None)
    category = re.sub(r"[^A-Z0-9]", "", values.get("order_type", "").upper())
    category = {"HOMEWIRELESS": "HW", "PREPAID": "WASEL", "POSTPAID": "NEW"}.get(category, category)
    if category in {"NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR"}:
        values["order_type"] = category
    else:
        values.pop("order_type", None)
    return values


@router.post("/read-order")
def read_order(body: IdentityImage, user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    try:
        result = extractor.extract(base64.b64decode(body.image_base64, validate=True))
    except Exception:
        raise HTTPException(422, "Order screen couldn't be read. Take a clearer photo.")
    lines = result.get("lines", [])
    fields = order_fields(lines)
    text = " ".join(str(line.get("text", "")) for line in lines).lower()
    if not re.search(r"order\s+details|package\s+name|request\s+id", text) or not all(
        fields.get(key) for key in (*ORDER_KEYS, "package_name")
    ):
        return fields
    available = db.scalars(select(Plan).where(Plan.active.is_(True))).all()
    name = re.sub(r"[^\w]", "", fields["package_name"]).casefold()
    matches = [plan for plan in available if re.sub(r"[^\w]", "", plan.name).casefold() == name]
    if len(matches) == 1:
        fields["plan_id"] = matches[0].id
        fields["plan_name"] = matches[0].name
    fields["order_check"] = cipher.encrypt(
        json.dumps(
            {
                "image": hashlib.sha256(
                    base64.b64decode(body.image_base64, validate=True)
                ).hexdigest(),
                "fields": {key: fields[key] for key in ORDER_KEYS},
                "user": user.id,
                "expires": now().timestamp() + 30 * 86400,
            }
        ).encode()
    ).decode()
    fields["order_fields"] = [
        {"label": str(field.get("label", ""))[:120], "value": str(field.get("value", ""))[:1000]}
        for row in result.get("rows", [])
        for field in row.get("fields", [])
    ][:100]
    return fields


@router.get("/leader-confirmations")
def leader_confirmations(user=Depends(principal), db=Depends(get_db)):
    if db.get(Role, user.role_id).name != "Team Leader":
        raise HTTPException(403, "Team leader access required")
    rows = db.scalars(
        select(KycCapture)
        .where(capture_scope(db, user), KycCapture.status == "VERIFIED")
        .order_by(KycCapture.updated_at.desc())
    ).all()
    return [view(row) for row in rows]


class LeaderConfirmation(BaseModel):
    version: int
    note: str = Field(min_length=3, max_length=300)


@router.post("/{capture_id}/leader-confirm")
def leader_confirm(
    capture_id: str,
    body: LeaderConfirmation,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    if db.get(Role, user.role_id).name != "Team Leader":
        raise HTTPException(403, "Team leader access required")
    get_capture(db, user, capture_id, True)
    raise HTTPException(403, "Transactions are confirmed by backend staff; team leaders have read-only access")


class CaptureBody(BaseModel):
    document_kind: Literal["ACTIVATION_RECEIPT", "PAYMENT_CONFIRMATION"] = "ACTIVATION_RECEIPT"
    agent_id: str
    operation_id: str = Field(min_length=16, max_length=80)
    source_reference: str = Field(default="", max_length=120)
    image_base64: str = Field(max_length=5_333_336)
    intake: Intake | None = None


@router.post("", status_code=201)
def create(body: CaptureBody, request: Request, user=Depends(principal), db=Depends(get_db)):
    access(db, user, True)
    assert_agent(db, user, body.agent_id)
    try:
        data = base64.b64decode(body.image_base64, validate=True)
        image_type = inspect_image(data)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc))
    if body.document_kind == "PAYMENT_CONFIRMATION" and not body.intake:
        raise HTTPException(422, "Complete customer details before uploading payment confirmation")
    if body.intake:
        body.intake.complete()
        check_document_evidence(body.intake, user)
        check_order_evidence(body.intake, user)
        plan = db.get(Plan, body.intake.plan_id)
        if not plan or not plan.active:
            raise HTTPException(422, "Select an available plan")
        body.intake.plan_name = plan.name
    if body.document_kind == "PAYMENT_CONFIRMATION":
        body.intake.transaction_id = body.intake.transaction_id or body.operation_id
    source = body.source_reference.strip() or (
        "PAY-" + body.operation_id[:24] if body.document_kind == "PAYMENT_CONFIRMATION" else ""
    )
    digest = hashlib.sha256(data).hexdigest()
    existing = db.scalar(select(KycCapture).where(KycCapture.operation_id == body.operation_id))

    def replay(row):
        if (
            row.creator_id != user.id
            or row.image_hash != digest
            or row.agent_id != body.agent_id
            or row.source_reference != source
            or payload(row).get("document_kind", "ACTIVATION_RECEIPT") != body.document_kind
            or payload(row).get("intake")
            != (body.intake.model_dump(mode="json") if body.intake else None)
        ):
            raise HTTPException(409, "This upload identifier was already used for another capture")
        return view(row)

    if existing:
        return replay(existing)
    if not source:
        raise HTTPException(422, "Enter the source transaction reference")
    queued = db.scalar(
        select(func.count()).select_from(KycCapture).where(KycCapture.status == "QUEUED")
    )
    if queued >= 20:
        raise HTTPException(429, "OCR queue is busy. Keep the image and retry shortly.")
    row = KycCapture(
        agent_id=body.agent_id,
        creator_id=user.id,
        operation_id=body.operation_id,
        source_reference=source,
        image_hash=digest,
        image_type=image_type,
        image_encrypted=cipher.encrypt(data).decode(),
        version=1,
        status="QUEUED",
    )
    db.add(row)
    try:
        db.flush()
        content = {"rows": [], "lines": [], "history": [], "document_kind": body.document_kind}
        if body.document_kind == "PAYMENT_CONFIRMATION":
            content["payment_reference"] = body.source_reference.strip()
            content["plan_snapshot"] = {
                "name": plan.name,
                "monthly_cost": plan.monthly_cost,
                "promotion": plan.promotion,
                "vat": plan.vat,
            }
        if body.intake:
            content["intake"] = body.intake.model_dump(mode="json")
        draft = db.scalar(
            select(CaptureDraft).where(CaptureDraft.creator_id == user.id).with_for_update()
        )
        if draft and body.intake:
            draft_data = payload(draft)
            keys = [
                "name",
                "document_number",
                "document_image",
                "sim_identifier",
                "plan_id",
                "signature",
            ]
            if all(draft_data.get(k) == content["intake"].get(k) for k in keys):
                store(draft, {})
                draft.version += 1
        if body.intake and body.intake.transaction_id and body.intake.sim_identifier:
            from .sim_scanning import claim

            _, progress = claim(
                db,
                user,
                body.intake.sim_identifier,
                body.intake.transaction_id,
                body.agent_id,
                request,
            )
            if progress.capture_id and progress.capture_id != row.id:
                raise HTTPException(409, "This SIM transaction already has a payment submission")
            progress.capture_id, progress.stage, progress.payment_status = (
                row.id,
                "PENDING_VERIFICATION",
                "UPLOADED",
            )
            saved = (
                db.get(SavedCaptureDraft, body.intake.saved_draft_id)
                if body.intake.saved_draft_id
                else None
            )
            if saved and saved.creator_id == user.id:
                db.delete(saved)
        record(db, row, user, "Receipt uploaded", request, content)
        db.commit()
    except IntegrityError:
        db.rollback()
        return replay(
            db.scalar(select(KycCapture).where(KycCapture.operation_id == body.operation_id))
        )
    return view(row)


@router.get("")
def listing(
    user=Depends(principal),
    db=Depends(get_db),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str = Query("", max_length=120),
    include_samples: bool = False,
    stage: Literal["", "READY", "COMPLETED"] = "",
    status: Literal[
        "", "QUEUED", "OCR_FAILED", "EXTRACTED", "VALIDATED", "SUBMITTED", "VERIFIED", "REJECTED"
    ] = "",
):
    access(db, user)
    q = select(KycCapture).where(capture_scope(db, user))
    if search.strip():
        q = q.where(KycCapture.source_reference.icontains(search.strip(), autoescape=True))
    elif not include_samples:
        for prefix in SAMPLE_REFERENCE_PREFIXES:
            q = q.where(~KycCapture.source_reference.like(prefix))
    if stage:
        q = q.where(KycCapture.status == "VERIFIED")
    elif status:
        q = q.where(KycCapture.status == status)
    q = q.order_by(KycCapture.created_at.desc(), KycCapture.id.desc())
    if stage:
        rows = [
            row
            for row in db.scalars(q)
            if payload(row).get("document_kind") == "PAYMENT_CONFIRMATION"
            and ((payload(row).get("activation") or {}).get("status") == "ACTIVATED")
            == (stage == "COMPLETED")
        ]
        return [view(row, False) for row in rows[offset : offset + limit]]
    return [view(row, False) for row in db.scalars(q.offset(offset).limit(limit))]


@router.get("/{capture_id}")
def detail(capture_id: str, user=Depends(principal), db=Depends(get_db)):
    return view(get_capture(db, user, capture_id))


@router.get("/{capture_id}/original")
def original(capture_id: str, user=Depends(principal), db=Depends(get_db)):
    row = get_capture(db, user, capture_id)
    return Response(
        cipher.decrypt(row.image_encrypted.encode()),
        media_type=row.image_type,
        headers={
            "Content-Disposition": 'attachment; filename="capture-'
            + row.id
            + ('.png"' if row.image_type == "image/png" else '.jpg"')
        },
    )


@router.get("/{capture_id}/receipt")
def receipt(capture_id: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    row = get_capture(db, user, capture_id)
    data = payload(row)
    status = (
        "SUCCESS — RECEIPT VERIFIED"
        if row.status == "VERIFIED"
        else ("CORRECTION REQUIRED" if row.status == "REJECTED" else "FINAL REVIEW PENDING")
    )
    intake = data.get("intake") or {}
    entries = [
        ("Reference", row.source_reference),
        ("Status", status),
        ("Date", row.created_at.strftime("%d %b %Y %H:%M UTC")),
    ]
    entries += [
        (label, intake[key])
        for key, label in [
            ("name", "Customer"),
            ("msisdn", "Phone number"),
            ("plan_name", "Plan"),
            ("sim_type", "SIM type"),
        ]
        if intake.get(key)
    ]
    if intake.get("document_number"):
        entries.append(("ID number", "**** " + str(intake["document_number"])[-4:]))
    if intake.get("sim_identifier"):
        entries.append(("SIM serial", intake["sim_identifier"]))
    for item in data.get("rows", []):
        fields = item.get("fields") or [
            {"label": key, "value": item.get(key, "")}
            for key in ["reference", "customer", "account", "details"]
        ]
        for field in fields:
            if not str(field.get("value", "")).strip():
                continue
            label, value = str(field["label"]), str(field["value"])
            import re

            if re.search(
                r"document|passport|identity|customer.*id|subscriber.*id|emirates.*id|national.*id|^id(?:\s|$)",
                label,
                re.I,
            ):
                value = "**** " + value[-4:]
            entries.append((label, value))
    payment = data.get("document_kind") == "PAYMENT_CONFIRMATION"
    if payment:
        projected = invoice(row, data)
        status = projected["heading"] + " — " + projected["status"]
        entries = [
            (section["title"] + " / " + f["label"], f["value"])
            for section in projected["sections"]
            for f in section["fields"]
        ]
    out = io.BytesIO()
    styles = getSampleStyleSheet()
    story = [
        Paragraph(
            "RELAY | PAYMENT INVOICE" if payment else "RELAY | ACTIVATION RECEIPT", styles["Title"]
        ),
        Paragraph(escape(status), styles["Heading2"]),
        Spacer(1, 16),
    ]
    cells = [
        [Paragraph(escape(str(k)), styles["Normal"]), Paragraph(escape(str(v)), styles["Normal"])]
        for k, v in entries
    ]
    table = Table(cells, colWidths=[160, 355])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f0f7f5")]),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    story.append(table)
    SimpleDocTemplate(out, pagesize=A4, leftMargin=40, rightMargin=40).build(story)
    audit(
        db,
        user,
        "Receipt Generated",
        row.id,
        row.agent_id,
        new={"status": row.status},
        request=request,
    )
    db.commit()
    return Response(
        out.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{"invoice" if payment else "receipt"}-{row.id}.pdf"'
        },
    )


class VersionBody(BaseModel):
    version: int = Field(ge=1)


def version_check(row, body):
    if row.version != body.version:
        raise HTTPException(409, "This capture changed. Reload it before saving.")


class ReceiptField(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    value: str = Field(max_length=1000)
    source_line: int | None = Field(default=None, ge=0, le=199)
    confidence: float | None = Field(default=None, ge=0, le=100)


class TransactionRow(BaseModel):
    reference: str = Field(default="", max_length=120)
    customer: str = Field(default="", max_length=120)
    account: str = Field(default="", max_length=80)
    details: str = Field(default="", max_length=1000)
    fields: list[ReceiptField] | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_content(self):
        if self.fields is not None:
            if any(not f.label.strip() for f in self.fields) or not any(
                f.value.strip() for f in self.fields
            ):
                raise ValueError("Each field needs a label and the transaction needs a value")
        elif len(self.reference.strip()) < 2 or len(self.details.strip()) < 2:
            raise ValueError("Legacy rows need a reference and details")
        return self

    source_line: int | None = Field(default=None, ge=0, le=199)


class RowsBody(VersionBody):
    rows: list[TransactionRow] = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=3, max_length=300)


@router.patch("/{capture_id}/rows")
def save_rows(
    capture_id: str, body: RowsBody, request: Request, user=Depends(principal), db=Depends(get_db)
):
    access(db, user, True)
    row = get_capture(db, user, capture_id, True)
    version_check(row, body)
    if row.status not in {"EXTRACTED", "OCR_FAILED", "VALIDATED", "REJECTED"}:
        raise HTTPException(409, "Rows cannot be edited at this stage")
    rows = [r.model_dump(mode="json") for r in body.rows]
    legacy = [r for r in rows if r.get("fields") is None]
    refs = [r["reference"].strip().casefold() for r in legacy]
    if len(set(refs)) != len(refs):
        raise HTTPException(422, "Legacy transaction references must be unique")
    data = payload(row)
    if any(r.get("fields") is not None for r in data.get("rows", [])) and any(
        r.get("fields") is None for r in rows
    ):
        raise HTTPException(
            409, "This receipt uses dynamic fields. Update the app before editing it."
        )
    sources = [r["source_line"] for r in rows]
    sources += [f["source_line"] for r in rows for f in (r.get("fields") or [])]
    if any(n is not None and n >= len(data.get("lines", [])) for n in sources):
        raise HTTPException(422, "Invalid source line")
    data.setdefault("revisions", []).append(
        {
            "rows": data.get("rows", []),
            "reason": body.reason,
            "actor": user.name,
            "at": now().isoformat(),
        }
    )
    data["rows"] = rows
    row.status = "VALIDATED"
    record(db, row, user, "KYC Rows Validated", request, data)
    db.commit()
    return view(row)


@router.post("/{capture_id}/submit")
def submit(
    capture_id: str,
    body: VersionBody,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    access(db, user, True)
    row = get_capture(db, user, capture_id, True)
    if row.status == "SUBMITTED":
        return view(row)
    version_check(row, body)
    if row.status != "VALIDATED":
        raise HTTPException(409, "Review and validate transaction rows before submission")
    row.status = "SUBMITTED"
    from .sales_management import register_capture_sale
    register_capture_sale(db, row)
    record(db, row, user, "KYC Submitted for Backend Review", request)
    db.commit()
    return view(row)


class ReviewBody(VersionBody):
    outcome: Literal["VERIFIED", "REJECTED"]
    reason: str = Field(min_length=5, max_length=300)


@router.post("/{capture_id}/review")
def review(
    capture_id: str, body: ReviewBody, request: Request, user=Depends(principal), db=Depends(get_db)
):
    require(db, user, "compliance.write")
    row = get_capture(db, user, capture_id, True)
    version_check(row, body)
    if row.status != "SUBMITTED":
        raise HTTPException(409, "Only submitted captures can be reviewed")
    if row.creator_id == user.id:
        raise HTTPException(403, "Another authorized reviewer must verify this capture")
    data = payload(row)
    if body.outcome == "VERIFIED" and data.get("intake"):
        Intake.model_validate(data["intake"]).complete()
    data["review"] = {
        "outcome": body.outcome,
        "reason": body.reason,
        "reviewer": user.name,
        "at": now().isoformat(),
    }
    data.pop("leader_confirmation", None)
    if body.outcome == "VERIFIED":
        from .db import SalesRecord
        sale = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == row.id))
        agent = db.get(Agent, row.agent_id)
        leader_id = sale.leader_id if sale else agent.leader_id if agent else None
        if leader_id:
            db.add(
                Notification(
                    user_id=leader_id,
                    message=f"Transaction confirmed by backend: {row.source_reference[:120]}.",
                )
            )
    progress = db.scalar(
        select(SimProgress).where(SimProgress.capture_id == row.id).with_for_update()
    )
    if progress:
        progress.payment_status = "VERIFIED" if body.outcome == "VERIFIED" else "REJECTED"
        progress.stage = (
            "READY_FOR_ACTIVATION" if body.outcome == "VERIFIED" else "CORRECTION_REQUIRED"
        )
    row.status, row.reviewer_id = body.outcome, user.id
    if (data.get("intake") or {}).get("capture_mode") == "SCREENSHOT_ORDER":
        from .db import SalesRecord
        from .sales_management import change_sale_status
        sale = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == row.id).with_for_update())
        if sale:
            change_sale_status(db, sale, "CLOSED" if body.outcome == "VERIFIED" else "IN_PROGRESS", user, request)
    record(db, row, user, "KYC Backend " + body.outcome, request, data)
    db.commit()
    return view(row)


@router.post("/{capture_id}/retry")
def retry(
    capture_id: str,
    body: VersionBody,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    access(db, user, True)
    row = get_capture(db, user, capture_id, True)
    version_check(row, body)
    if row.status != "OCR_FAILED":
        raise HTTPException(409, "Only failed extraction can be retried")
    row.status, row.error = "QUEUED", ""
    record(db, row, user, "KYC OCR Retried", request)
    db.commit()
    return view(row)


@router.get("/{capture_id}/excel")
def excel(capture_id: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    row = get_capture(db, user, capture_id)
    data = payload(row)
    if row.status not in {"VALIDATED", "SUBMITTED", "VERIFIED", "REJECTED"} or not data.get("rows"):
        raise HTTPException(409, "Validate at least one transaction row before export")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Transactions"
    dynamic = any(r.get("fields") is not None for r in data["rows"])
    if dynamic:
        sheet.append(
            [
                "Transaction",
                "Field",
                "Value",
                "OCR confidence",
                "Source line",
                "Source image reference",
                "Backend verification status",
            ]
        )
        for index, item in enumerate(data["rows"]):
            fields = item.get("fields")
            if fields is None:
                fields = [
                    {"label": k, "value": item.get(k, ""), "source_line": item.get("source_line")}
                    for k in ["reference", "customer", "account", "details"]
                ]
            for field in fields:
                source = field.get("source_line")
                confidence = field.get("confidence")
                sheet.append(
                    [
                        str(index + 1),
                        field["label"],
                        field["value"],
                        str(confidence) if confidence is not None else "",
                        str(source + 1) if source is not None else "Manual",
                        f"capture-{row.id}",
                        row.status,
                    ]
                )
    else:
        sheet.append(
            [
                "Transaction reference",
                "Customer",
                "Account / MSISDN",
                "Details",
                "Source line",
                "Source image reference",
                "AI extraction status",
                "Backend verification status",
            ]
        )
        for item in data["rows"]:
            source = item.get("source_line")
            sheet.append(
                [
                    item["reference"],
                    item["customer"],
                    item["account"],
                    item["details"],
                    str(source + 1) if source is not None else "Manual",
                    f"capture-{row.id}.{'jpg' if row.image_type == 'image/jpeg' else 'png'}",
                    "EXTRACTED",
                    row.status if row.status in {"VERIFIED", "REJECTED"} else "PENDING",
                ]
            )
    for cells in sheet.iter_rows():
        for cell in cells:
            cell.data_type = "s"
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for cell in sheet[1]:
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = PatternFill("solid", fgColor="761B3A")
    from openpyxl.utils import get_column_letter

    for col in range(1, sheet.max_column + 1):
        sheet.column_dimensions[get_column_letter(col)].width = 48 if col == 3 else 28
    meta = workbook.create_sheet("Provenance")
    for key, value in [
        ("Capture", row.id),
        ("Source reference", row.source_reference),
        ("Original SHA-256", row.image_hash),
        ("Generated UTC", datetime.utcnow().isoformat()),
        ("OCR engine", "Tesseract on VPS"),
        ("Verification", row.status),
        ("Review", data.get("review", {}).get("reason", "Pending backend review")),
    ]:
        meta.append([key, value])
        meta.cell(meta.max_row, 2).data_type = "s"
    meta.column_dimensions["A"].width = 24
    meta.column_dimensions["B"].width = 80
    out = io.BytesIO()
    workbook.save(out)
    audit(db, user, "KYC Excel Exported", row.id, row.agent_id, request=request)
    db.commit()
    return Response(
        out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="kyc-{row.id}.xlsx"'},
    )


def process_capture():
    with DB() as db:
        row = db.scalar(
            select(KycCapture)
            .where(KycCapture.status == "QUEUED")
            .order_by(KycCapture.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not row:
            return
        user = db.get(User, row.creator_id)
        data = payload(row)
        try:
            extracted = extractor.extract(cipher.decrypt(row.image_encrypted.encode()))
            data.update({k: v for k, v in extracted.items() if k != "history"})
            row.status, row.error = "EXTRACTED", ""
        except ValueError:
            row.status, row.error = (
                "OCR_FAILED",
                "No readable text or unsupported image. Try a clearer PNG/JPEG screenshot.",
            )
        except Exception:
            row.status, row.error = (
                "OCR_FAILED",
                "Could not read the receipt. Try again or contact your team.",
            )
        record(db, row, user, "KYC OCR " + row.status, data=data)
        db.commit()


class ActivationBody(VersionBody):
    outcome: Literal["ACTIVATED", "FAILED"]
    reference: str = Field(min_length=3, max_length=100)
    reason: str = Field(min_length=5, max_length=300)


@router.post("/{capture_id}/activation")
def complete_activation(
    capture_id: str,
    body: ActivationBody,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    require(db, user, "compliance.write")
    require(db, user, "ekyc.write")
    row = get_capture(db, user, capture_id, True)
    version_check(row, body)
    data = payload(row)
    if data.get("document_kind") != "PAYMENT_CONFIRMATION" or row.status != "VERIFIED":
        raise HTTPException(409, "Verify the payment submission before recording activation")
    if (data.get("activation") or {}).get("status") == "ACTIVATED":
        raise HTTPException(409, "Activation is already recorded")
    if len(body.reference.strip()) < 3 or len(body.reason.strip()) < 5:
        raise HTTPException(422, "Enter the activation reference and completion note")
    intake = data.get("intake") or {}
    if intake.get("capture_mode") == "SCREENSHOT_ORDER":
        raise HTTPException(409, "External activation is recorded through independent backend review")
    sim = None
    if intake.get("sim_identifier"):
        sim = db.scalar(
            select(Sim)
            .where(
                (Sim.iccid == intake["sim_identifier"]) | (Sim.serial == intake["sim_identifier"])
            )
            .with_for_update()
        )
    if sim is None and (
        intake.get("sim_identifier") or intake.get("capture_mode") != "SCREENSHOT_ORDER"
    ):
        raise HTTPException(
            409, "SIM not found in inventory. Resolve stock before recording activation."
        )
    if sim and (
        sim.agent_id != row.agent_id
        or sim.status not in {"AVAILABLE", "ASSIGNED TO AGENT", "RESERVED"}
    ):
        raise HTTPException(
            409, "SIM ownership or status changed. Resolve inventory before activation."
        )
    order = db.get(Order, data.get("order_id")) if data.get("order_id") else None
    if order is None:
        customer = Customer(
            agent_id=row.agent_id,
            name=intake["name"],
            mobile=intake["msisdn"],
            nationality=intake["nationality"],
        )
        db.add(customer)
        db.flush()
        suffix = row.id.replace("-", "")[:24]
        order = Order(
            reference="PAY-" + suffix,
            request_id="REQ-" + suffix,
            sr_id="SR-" + suffix,
            operation_id="payment-" + row.id,
            agent_id=row.agent_id,
            customer_id=customer.id,
            plan_id=intake["plan_id"],
            msisdn=intake["msisdn"],
            sim_id=sim.id if sim else None,
            status=body.outcome,
            draft={"capture_id": row.id},
        )
        db.add(order)
        db.flush()
        data["order_id"] = order.id
    order.status, order.updated_at = body.outcome, now()
    activation = db.scalar(select(Activation).where(Activation.order_id == order.id))
    if activation is None:
        activation = Activation(
            order_id=order.id, provider_reference=body.reference.strip(), status=body.outcome
        )
        db.add(activation)
    else:
        activation.status, activation.provider_reference = body.outcome, body.reference.strip()
    db.add(
        OrderEvent(order_id=order.id, actor=user.name, action="Backend recorded " + body.outcome)
    )
    if sim and body.outcome == "ACTIVATED":
        previous = sim.status
        sim.status, sim.activated_at = "ACTIVATED", now()
        db.add(
            Movement(
                sim_id=sim.id,
                agent_id=row.agent_id,
                user_id=user.id,
                old_status=previous,
                new_status=sim.status,
                reason=body.reason.strip(),
            )
        )
        audit(
            db,
            user,
            "SIM Activated",
            sim.id,
            row.agent_id,
            new={"status": sim.status},
            request=request,
        )
    progress = db.scalar(
        select(SimProgress).where(SimProgress.capture_id == row.id).with_for_update()
    )
    if progress:
        progress.stage = body.outcome
    data["activation"] = {
        "status": body.outcome,
        "reference": body.reference.strip(),
        "reason": body.reason.strip(),
        "actor": user.name,
        "at": now().isoformat(),
    }
    record(db, row, user, "Backend activation " + body.outcome, request, data)
    from .sales_management import record_capture_activation
    record_capture_activation(db, row, body.outcome)
    db.commit()
    return view(row)
