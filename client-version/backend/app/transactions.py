"""Three-stage reference journey. Real VPS OCR; explicit demo identity/carrier adapters."""

import base64
import io
import json
import re
import secrets
import subprocess
from datetime import date
from typing import Literal
from decimal import Decimal, ROUND_HALF_UP
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from PIL import Image, ImageDraw
from .db import Order, OrderEvent, Plan, Sim, Customer, Document, Ekyc, get_db, now, business_date
from .security import principal, require, assert_agent, visible_agents, cipher
from .services import audit, order_view, raw, submit
from .capture_ocr import extractor, inspect_image
from . import providers

router = APIRouter(prefix="/api/transactions", tags=["Reference transaction journey"])


def payload(order):
    value = order.draft.get("transaction_data")
    return json.loads(cipher.decrypt(value.encode())) if value else {}


def save(order, data):
    order.draft = {
        **order.draft,
        "transaction_data": cipher.encrypt(json.dumps(data).encode()).decode(),
        "transaction_version": order.draft.get("transaction_version", 0) + 1,
    }
    order.updated_at = now()


def view(db, order):
    result = order_view(db, order)
    result.pop("draft", None)
    data = payload(order)
    plan = db.get(Plan, order.plan_id) if order.plan_id else None
    result.update(
        data=data,
        version=order.draft.get("transaction_version", 0),
        mode="DEMO",
        stage=3 if order.status != "DRAFT" else 2 if data.get("identity_verified") else 1,
    )
    if plan:
        total = Decimal(str(plan.monthly_cost))
        vat = (total * Decimal(str(plan.vat)) / (100 + Decimal(str(plan.vat)))).quantize(
            Decimal(".01"), rounding=ROUND_HALF_UP
        )
        result["receipt"] = {
            "total": str(total),
            "vat": str(vat),
            "currency": "AED",
            "payment": "Not collected — demo",
            "plan": plan.name,
        }
    return result


def owned(db, user, identifier, version=None, editable=False):
    require(db, user, "ekyc.write" if editable else "read")
    order = db.scalar(select(Order).where(Order.id == identifier).with_for_update())
    if not order or "transaction_data" not in order.draft:
        raise HTTPException(404, "Transaction not found")
    assert_agent(db, user, order.agent_id)
    if version is not None and version != order.draft.get("transaction_version"):
        raise HTTPException(409, "This transaction changed. Refresh before continuing.")
    if editable and order.status != "DRAFT":
        raise HTTPException(409, "Submitted transactions cannot be edited")
    return order


class Start(BaseModel):
    agent_id: str
    operation_id: str = Field(min_length=8, max_length=80)


@router.post("")
def start(body: Start, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "ekyc.write")
    assert_agent(db, user, body.agent_id)
    if db.bind.dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:operation, 0))"),
            {"operation": body.operation_id},
        )
    order = db.scalar(select(Order).where(Order.operation_id == body.operation_id))
    if order:
        assert_agent(db, user, order.agent_id)
        if order.agent_id != body.agent_id or "transaction_data" not in order.draft:
            raise HTTPException(409, "Operation already used")
        return view(db, order)
    ref = secrets.token_hex(5).upper()
    order = Order(
        agent_id=body.agent_id,
        operation_id=body.operation_id,
        reference="RLY-" + ref,
        request_id="REQ-" + ref,
        sr_id="SR-" + ref,
        msisdn="DEMO-" + ref,
    )
    order.draft = {}
    save(
        order,
        {
            "document_type": "National Identity Card",
            "identity_verified": False,
            "liveness": "NOT_STARTED",
        },
    )
    db.add(order)
    db.flush()
    db.add(OrderEvent(order_id=order.id, actor=user.name, action="Transaction created"))
    audit(db, user, "Transaction Created", order.id, order.agent_id, request=request)
    db.commit()
    return view(db, order)


@router.get("")
def listing(user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    orders = db.scalars(
        select(Order)
        .where(Order.agent_id.in_(visible_agents(db, user)))
        .order_by(Order.created_at.desc())
        .limit(300)
    ).all()
    return [
        {k: v for k, v in order_view(db, o).items() if k != "draft"}
        for o in orders
        if "transaction_data" in o.draft
    ]


@router.get("/catalog")
def catalog(agent_id: str, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    assert_agent(db, user, agent_id)
    return {
        "plans": [raw(p) for p in db.scalars(select(Plan).where(Plan.active.is_(True)))],
        "sims": [
            raw(s)
            for s in db.scalars(
                select(Sim).where(Sim.agent_id == agent_id, Sim.status == "AVAILABLE")
            )
        ],
        "numbers": ["DEMO-050-0001", "DEMO-050-0002", "DEMO-052-0003"],
    }


@router.get("/sample/{kind}")
def sample(kind: Literal["id", "passport"], user=Depends(principal)):
    image = Image.new("RGB", (1100, 650), "#f0f6fb")
    d = ImageDraw.Draw(image)
    lines = [
        "RELAY SYNTHETIC DOCUMENT - NOT VALID ID",
        "Name: Jordan Demo",
        "Document: DEMO-ID-1001" if kind == "id" else "Document: DEMO-PASS-1001",
        "Nationality: Synthetic UAE resident",
        "Expiry: 2030-12-31",
        "Date of birth: 1995-04-12",
    ]
    for i, line in enumerate(lines):
        d.text((40, 45 + i * 85), line, fill="#182838", font_size=30)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return {"image_base64": base64.b64encode(out.getvalue()).decode()}


@router.get("/{identifier}")
def get(identifier: str, user=Depends(principal), db=Depends(get_db)):
    return view(db, owned(db, user, identifier))


class Version(BaseModel):
    version: int = Field(ge=1)


class Scan(Version):
    document_type: Literal["National Identity Card", "Passport"]
    image_base64: str = Field(max_length=5_400_000)


@router.post("/{identifier}/scan")
def scan(
    identifier: str, body: Scan, request: Request, user=Depends(principal), db=Depends(get_db)
):
    order = owned(db, user, identifier, body.version, True)
    try:
        binary = base64.b64decode(body.image_base64, validate=True)
        inspect_image(binary)
        result = extractor.extract(binary)
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(
            422, "Image could not be extracted. Use a clear PNG/JPEG demo document."
        ) from exc
    lines = result["lines"]
    combined = "\n".join(line["text"] for line in lines)
    data = {
        "document_type": body.document_type,
        "identity_verified": False,
        "liveness": "NOT_STARTED",
        "ocr_lines": lines,
        "image": body.image_base64,
    }
    for key, label in [
        ("name", "Name"),
        ("document_number", "Document"),
        ("nationality", "Nationality"),
        ("expiry", "Expiry"),
        ("dob", "Date of birth"),
    ]:
        match = re.search(r"^" + label + r"\s*:\s*(.+)$", combined, re.I | re.M)
        data[key] = match.group(1).strip() if match else ""
    if not data["document_number"].startswith("DEMO-"):
        raise HTTPException(
            422,
            "Use a synthetic document with a DEMO- identifier. Real identities are not accepted in this demo.",
        )
    order.sim_id = None
    order.plan_id = None
    order.ekyc_id = None
    save(order, data)
    audit(
        db,
        user,
        "Demo Document OCR",
        order.id,
        order.agent_id,
        new={"lines": len(lines), "provider": "VPS Tesseract"},
        request=request,
    )
    db.commit()
    return view(db, order)


class Identity(Version):
    name: str = Field(min_length=2, max_length=120)
    document_number: str = Field(pattern=r"^DEMO-.{3,70}$")
    nationality: str = Field(min_length=2, max_length=80)
    expiry: date
    dob: date


@router.post("/{identifier}/identity")
def identity(
    identifier: str, body: Identity, request: Request, user=Depends(principal), db=Depends(get_db)
):
    order = owned(db, user, identifier, body.version, True)
    data = payload(order)
    if not data.get("ocr_lines"):
        raise HTTPException(422, "Scan a document first")
    if body.expiry < business_date() or body.dob >= business_date():
        raise HTTPException(422, "Check date of birth and document expiry")
    data.update(body.model_dump(mode="json", exclude={"version"}))
    data.update(
        identity_verified=False, liveness="NOT_STARTED", identity_saved=True, allocated=False
    )
    save(order, data)
    audit(db, user, "Identity Fields Reviewed", order.id, order.agent_id, request=request)
    db.commit()
    return view(db, order)


class Liveness(Version):
    scenario: Literal["pass", "fail"] = "pass"


@router.post("/{identifier}/liveness")
def liveness(
    identifier: str, body: Liveness, request: Request, user=Depends(principal), db=Depends(get_db)
):
    order = owned(db, user, identifier, body.version, True)
    data = payload(order)
    if not data.get("identity_saved"):
        raise HTTPException(422, "Save reviewed identity fields first")
    result = providers.liveness.verify(body.scenario)
    data["liveness"] = "SIMULATED_PASS" if body.scenario == "pass" else "SIMULATED_FAIL"
    data["identity_verified"] = body.scenario == "pass"
    if data["identity_verified"]:
        customer = (
            db.get(Customer, order.customer_id)
            if order.customer_id
            else Customer(agent_id=order.agent_id, mobile=order.msisdn)
        )
        customer.name = data["name"]
        customer.nationality = data["nationality"]
        db.add(customer)
        db.flush()
        order.customer_id = customer.id
        document = db.scalar(
            select(Document).where(Document.customer_id == customer.id)
        ) or Document(customer_id=customer.id)
        document.document_type = data["document_type"]
        document.encrypted_number = cipher.encrypt(data["document_number"].encode()).decode()
        document.expiry = data["expiry"]
        db.add(document)
        ekyc = Ekyc(
            agent_id=order.agent_id,
            customer_id=customer.id,
            status="VERIFIED",
            confidence=0,
            result={
                "provider": "MOCK",
                "authenticity": "SIMULATED",
                "liveness": True,
                "face_match": True,
            },
        )
        db.add(ekyc)
        db.flush()
        order.ekyc_id = ekyc.id
    save(order, data)
    audit(
        db,
        user,
        "Demo Liveness " + body.scenario,
        order.id,
        order.agent_id,
        new={"provider": "MOCK", "result": result["status"]},
        request=request,
    )
    db.commit()
    return view(db, order)


class Allocate(Version):
    plan_id: str
    sim_id: str
    msisdn: Literal["DEMO-050-0001", "DEMO-050-0002", "DEMO-052-0003"]
    signature: list[list[tuple[float, float]]] = Field(min_length=1, max_length=30)


@router.post("/{identifier}/allocate")
def allocate(
    identifier: str, body: Allocate, request: Request, user=Depends(principal), db=Depends(get_db)
):
    order = owned(db, user, identifier, body.version, True)
    data = payload(order)
    if not data.get("identity_verified"):
        raise HTTPException(422, "Complete the demo identity check first")
    points = [p for stroke in body.signature for p in stroke]
    if (
        len(points) < 8
        or len(points) > 3000
        or any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in points)
        or len(set(points)) < 5
    ):
        raise HTTPException(422, "Draw a signature inside the signature pad")
    sim = db.get(Sim, body.sim_id)
    plan = db.get(Plan, body.plan_id)
    if not sim or sim.agent_id != order.agent_id or sim.status != "AVAILABLE":
        raise HTTPException(409, "SIM is unavailable; refresh the assigned stock")
    if not plan or not plan.active:
        raise HTTPException(422, "Select an active plan")
    order.plan_id = plan.id
    order.sim_id = sim.id
    order.msisdn = body.msisdn
    if order.customer_id:
        db.get(Customer, order.customer_id).mobile = body.msisdn
    data.update(signature=body.signature, sim_type=sim.sim_type, iccid=sim.iccid, allocated=True)
    save(order, data)
    audit(
        db,
        user,
        "Demo Allocation Saved",
        order.id,
        order.agent_id,
        new={"plan_id": plan.id, "sim_id": sim.id, "signature_captured": True},
        request=request,
    )
    db.commit()
    return view(db, order)


@router.post("/{identifier}/submit")
def dispatch(
    identifier: str, body: Version, request: Request, user=Depends(principal), db=Depends(get_db)
):
    order = owned(db, user, identifier)
    require(db, user, "ekyc.write")
    if order.status in {"PROCESSING", "SUBMITTED", "ACTIVATED"}:
        return view(db, order)
    order = owned(db, user, identifier, body.version, True)
    data = payload(order)
    if not data.get("allocated") or not data.get("identity_verified"):
        raise HTTPException(422, "Complete identity, allocation and signature first")
    return view(
        db, submit(db, user, order.id, request, permission="ekyc.write", monitor_location=False)
    )


@router.get("/{identifier}/receipt")
def receipt(identifier: str, user=Depends(principal), db=Depends(get_db)):
    from .main import pdf_bytes

    order = owned(db, user, identifier)
    if order.status != "ACTIVATED":
        raise HTTPException(409, "Receipt available after demo activation completes")
    v = view(db, order)
    rows = [
        {"Field": k.replace("_", " ").title(), "Value": v[k]}
        for k in [
            "reference",
            "request_id",
            "sr_id",
            "customer",
            "plan",
            "msisdn",
            "agent",
            "outlet",
            "status",
        ]
    ]
    rows += [{"Field": k.title(), "Value": value} for k, value in v["receipt"].items()]
    return Response(
        pdf_bytes(
            "Demo activation receipt",
            rows,
            "DEMO ONLY - no payment collected; no carrier or regulatory approval",
        ),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{order.reference}.pdf"'},
    )


@router.post("/{identifier}/sms")
def sms(identifier: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    order = owned(db, user, identifier)
    require(db, user, "ekyc.write")
    if order.status != "ACTIVATED":
        raise HTTPException(409, "Complete demo activation first")
    result = providers.sms.send(order.msisdn, "receipt")
    audit(db, user, "Receipt SMS Simulated", order.id, order.agent_id, new=result, request=request)
    db.commit()
    return result
