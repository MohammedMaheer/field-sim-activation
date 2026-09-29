"""Sales management records independent of carrier and payment integrations."""

import base64
import csv
import hashlib
import io
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from itertools import islice
from zipfile import ZipFile
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from openpyxl import load_workbook

from .db import (
    Agent, Branch, CallAttempt, NoSaleFeedback, Outlet, Role, SalesRecord,
    SalesTarget, User, get_db, now,
)
from .security import assert_agent, cipher, permissions, principal
from .services import audit

router = APIRouter(prefix="/api/sales-management", tags=["Sales management"])
ORDER_TYPES = ("NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR")
SALE_STATUSES = ("IN_PROGRESS", "CLOSED", "CANCELLED")
CALL_STAGES = ("TELE_VERIFICATION", "WELCOME_CALL")


def assignment(db, agent_id):
    agent = db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    outlet = db.get(Outlet, agent.outlet_id)
    return agent, outlet


def permitted(db, user, row):
    role = db.get(Role, user.role_id).name
    if role == "Field Agent":
        return db.get(Agent, row.agent_id).user_id == user.id
    if role == "Team Leader":
        return row.leader_id == user.id
    if role == "Branch Manager":
        return row.branch_id == user.branch_id
    return "read" in permissions(db, user)


def scoped(db, user, model):
    role = db.get(Role, user.role_id).name
    query = select(model)
    if role == "Field Agent":
        agent = db.scalar(select(Agent).where(Agent.user_id == user.id))
        query = query.where(model.agent_id == (agent.id if agent else ""))
    elif role == "Team Leader":
        query = query.where(model.leader_id == user.id)
    elif role == "Branch Manager":
        query = query.where(model.branch_id == user.branch_id)
    elif "read" not in permissions(db, user):
        raise HTTPException(403, "Your role cannot view sales")
    return query


def sale_view(db, row):
    agent, outlet = assignment(db, row.agent_id)
    document = cipher.decrypt(row.document_encrypted.encode()).decode() if row.document_encrypted else ""
    return {
        "id": row.id, "created_at": row.created_at, "capture_id": row.capture_id,
        "agent_id": row.agent_id, "agent": db.get(User, agent.user_id).name,
        "leader_id": row.leader_id, "leader": (db.get(User, row.leader_id).name if db.get(User, row.leader_id) else "Not assigned") if row.leader_id else "Not assigned",
        "branch_id": row.branch_id, "branch": db.get(Branch, row.branch_id).name if db.get(Branch, row.branch_id) else "Former branch",
        "outlet_id": row.outlet_id, "outlet": db.get(Outlet, row.outlet_id).name if db.get(Outlet, row.outlet_id) else "Former outlet",
        "order_type": row.order_type, "customer_name": row.customer_name,
        "document": "•••• " + document[-4:] if document else "Not recorded",
        "nationality": row.nationality or "Not recorded",
        "plan_name": row.plan_name, "request_id": row.request_id or "Not recorded",
        "status": row.status, "status_updated_at": row.status_updated_at,
        **row.details,
    }


def register_capture_sale(db, capture):
    """Snapshot assignment when an agent submits the new screenshot-order flow."""
    from .captures import payload
    data = payload(capture)
    intake = data.get("intake") or {}
    if intake.get("capture_mode") != "SCREENSHOT_ORDER":
        return
    if db.scalar(select(SalesRecord.id).where(SalesRecord.capture_id == capture.id)):
        return
    agent, outlet = assignment(db, capture.agent_id)
    reference = (intake.get("order_reference") or "").strip() or None
    if reference and db.scalar(select(SalesRecord.id).where(SalesRecord.request_id == reference)):
        raise HTTPException(409, "This request ID is already recorded")
    document = (intake.get("document_number") or "").strip()
    record = SalesRecord(
        capture_id=capture.id, agent_id=agent.id, leader_id=agent.leader_id,
        branch_id=outlet.branch_id, outlet_id=outlet.id,
        order_type="UNSPECIFIED", customer_name=intake.get("name") or "Not recorded",
        document_encrypted=cipher.encrypt(document.encode()).decode() if document else "",
        nationality=intake.get("nationality") or "", plan_name=intake.get("package_name") or intake.get("plan_name") or "Not recorded",
        request_id=reference, status="IN_PROGRESS",
        details={"msisdn": intake.get("msisdn") or "", "source_reference": capture.source_reference,
                 "monthly_cost": intake.get("monthly_cost") or "", "prepayment": intake.get("prepayment") or "",
                 "request_id_on_image": intake.get("order_reference") or ""},
    )
    db.add(record)
    db.flush()


def record_capture_activation(db, capture, outcome):
    row = db.scalar(select(SalesRecord).where(SalesRecord.capture_id == capture.id))
    if row:
        row.status = "CLOSED" if outcome == "ACTIVATED" else "IN_PROGRESS"
        row.status_updated_at = now()


class SaleCreate(BaseModel):
    agent_id: str
    order_type: Literal["NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR"]
    customer_name: str = Field(min_length=2, max_length=120)
    document_number: str = Field(default="", max_length=80)
    nationality: str = Field(default="", max_length=80)
    plan_name: str = Field(min_length=2, max_length=160)
    request_id: str = Field(default="", max_length=120)
    account_number: str = Field(default="", max_length=120)
    sim_serial: str = Field(default="", max_length=100)
    router_serial: str = Field(default="", max_length=100)
    advance_transaction_number: str = Field(default="", max_length=120)
    sr_number: str = Field(default="", max_length=120)
    alternate_number: str = Field(default="", max_length=40)
    msisdn: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def conditional_fields(self):
        if not self.customer_name.strip() or not self.plan_name.strip():
            raise ValueError("Enter customer and plan names")
        if self.order_type == "HW" and not self.router_serial.strip():
            raise ValueError("Router serial is required for home wireless sales")
        return self


@router.get("/sales")
def sales(user=Depends(principal), db=Depends(get_db)):
    rows = db.scalars(scoped(db, user, SalesRecord).order_by(SalesRecord.created_at.desc()).limit(1000)).all()
    return [sale_view(db, row) for row in rows]


@router.get("/performance")
def performance(period: str = "", user=Depends(principal), db=Depends(get_db)):
    period = period or now().strftime("%Y-%m")
    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", period):
        raise HTTPException(422, "Period must use YYYY-MM")
    year, month = (int(part) for part in period.split("-"))
    dubai = ZoneInfo("Asia/Dubai")
    start = datetime(year, month, 1, tzinfo=dubai).astimezone(timezone.utc).replace(tzinfo=None)
    end_local = datetime(year + 1, 1, 1, tzinfo=dubai) if month == 12 else datetime(year, month + 1, 1, tzinfo=dubai)
    end = end_local.astimezone(timezone.utc).replace(tzinfo=None)
    query = scoped(db, user, SalesRecord).where(SalesRecord.created_at >= start, SalesRecord.created_at < end)
    rows = db.scalars(query).all()
    closed = [row for row in rows if row.status == "CLOSED"]
    product = {name: sum(row.order_type == name for row in closed) for name in ORDER_TYPES}
    product = {name: count for name, count in product.items() if count}
    target_rows = targets(period, user, db)
    by_agent = {}
    for target_row in target_rows:
        by_agent.setdefault(target_row["agent_id"], []).append(target_row)
    target = sum(next((item["monthly_target"] for item in items if item["order_type"] == "ALL"),
                      sum(item["monthly_target"] for item in items)) for items in by_agent.values())
    return {"period": period, "recorded": len(rows), "closed": len(closed),
            "in_progress": sum(row.status == "IN_PROGRESS" for row in rows),
            "cancelled": sum(row.status == "CANCELLED" for row in rows),
            "monthly_target": target, "remaining": max(target - len(closed), 0),
            "achievement_percent": round(len(closed) * 100 / target, 1) if target else None,
            "by_product": product}


@router.post("/sales", status_code=201)
def create_sale(body: SaleCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    assert_agent(db, user, body.agent_id)
    agent, outlet = assignment(db, body.agent_id)
    values = body.model_dump()
    reference = values.pop("request_id").strip() or None
    if reference and db.scalar(select(SalesRecord.id).where(SalesRecord.request_id == reference)):
        raise HTTPException(409, "This request ID is already recorded")
    name = values.pop("customer_name").strip()
    document = values.pop("document_number").strip()
    nationality = values.pop("nationality").strip()
    plan = values.pop("plan_name").strip()
    order_type = values.pop("order_type")
    values.pop("agent_id")
    row = SalesRecord(
        agent_id=agent.id, leader_id=agent.leader_id, branch_id=outlet.branch_id,
        outlet_id=outlet.id, order_type=order_type, customer_name=name,
        document_encrypted=cipher.encrypt(document.encode()).decode() if document else "",
        nationality=nationality, plan_name=plan, request_id=reference,
        status="IN_PROGRESS", details={key: value.strip() for key, value in values.items()},
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This request ID is already recorded") from None
    audit(db, user, "Sale Recorded", row.id, row.agent_id, new={"order_type": order_type, "status": row.status}, request=request)
    db.commit()
    return sale_view(db, row)


class SaleCorrection(BaseModel):
    order_type: Literal["NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR"]
    router_serial: str = Field(default="", max_length=100)
    reason: str = Field(min_length=5, max_length=300)


@router.patch("/sales/{sale_id}")
def correct_sale(sale_id: str, body: SaleCorrection, request: Request, user=Depends(principal), db=Depends(get_db)):
    if db.get(Role, user.role_id).name not in {"Administrator", "Operations Manager"}:
        raise HTTPException(403, "Only backend management can correct a sale")
    row = db.get(SalesRecord, sale_id)
    if not row or not permitted(db, user, row):
        raise HTTPException(404, "Sale not found")
    if body.order_type == "HW" and not body.router_serial.strip():
        raise HTTPException(422, "Router serial is required for home wireless sales")
    old = {"order_type": row.order_type, "router_serial": row.details.get("router_serial", "")}
    row.order_type = body.order_type
    row.details = {**row.details, "router_serial": body.router_serial.strip()}
    audit(db, user, "Sale Corrected", row.id, row.agent_id, old=old,
          new={"order_type": row.order_type, "router_serial": body.router_serial.strip()},
          reason=body.reason.strip(), request=request)
    db.commit()
    return sale_view(db, row)


class FeedbackCreate(BaseModel):
    agent_id: str
    customer_name: str = Field(default="", max_length=120)
    contact_number: str = Field(default="", max_length=40)
    product_suggested: str = Field(min_length=2, max_length=160)
    feedback: str = Field(min_length=3, max_length=1000)
    rejection_reason: str = Field(min_length=3, max_length=300)


@router.get("/feedback")
def feedback(user=Depends(principal), db=Depends(get_db)):
    rows = db.scalars(scoped(db, user, NoSaleFeedback).order_by(NoSaleFeedback.created_at.desc()).limit(1000)).all()
    return [{"id": row.id, "created_at": row.created_at,
             "agent_id": row.agent_id, "agent": db.get(User, db.get(Agent, row.agent_id).user_id).name,
             "branch_id": row.branch_id, "customer_name": row.customer_name,
             "contact": "•••• " + cipher.decrypt(row.contact_encrypted.encode()).decode()[-4:] if row.contact_encrypted else "Not recorded",
             "product_suggested": row.product_suggested, "feedback": row.feedback,
             "rejection_reason": row.rejection_reason} for row in rows]


@router.post("/feedback", status_code=201)
def create_feedback(body: FeedbackCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    assert_agent(db, user, body.agent_id)
    agent, outlet = assignment(db, body.agent_id)
    row = NoSaleFeedback(
        agent_id=agent.id, leader_id=agent.leader_id, branch_id=outlet.branch_id,
        customer_name=body.customer_name.strip(),
        contact_encrypted=cipher.encrypt(body.contact_number.strip().encode()).decode() if body.contact_number.strip() else "",
        product_suggested=body.product_suggested.strip(), feedback=body.feedback.strip(),
        rejection_reason=body.rejection_reason.strip(),
    )
    db.add(row)
    db.flush()
    audit(db, user, "No Sale Feedback Recorded", row.id, row.agent_id, new={"product": row.product_suggested}, request=request)
    db.commit()
    return {"id": row.id, "recorded": True}


class TargetWrite(BaseModel):
    agent_id: str
    period: str
    order_type: Literal["ALL", "NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR"] = "ALL"
    daily_target: int = Field(ge=0, le=1000)
    monthly_target: int = Field(ge=0, le=10000)


@router.get("/targets")
def targets(period: str = "", user=Depends(principal), db=Depends(get_db)):
    query = select(SalesTarget)
    role = db.get(Role, user.role_id).name
    if role == "Field Agent":
        agent = db.scalar(select(Agent).where(Agent.user_id == user.id))
        query = query.where(SalesTarget.agent_id == (agent.id if agent else ""))
    elif role == "Team Leader":
        query = query.where(SalesTarget.agent_id.in_(select(Agent.id).where(Agent.leader_id == user.id)))
    elif role == "Branch Manager":
        query = query.where(SalesTarget.agent_id.in_(select(Agent.id).join(Outlet).where(Outlet.branch_id == user.branch_id)))
    if period:
        query = query.where(SalesTarget.period == period)
    rows = db.scalars(query.order_by(SalesTarget.period.desc(), SalesTarget.created_at.desc())).all()
    return [{"id": row.id, "agent_id": row.agent_id, "agent": db.get(User, db.get(Agent, row.agent_id).user_id).name,
             "period": row.period, "order_type": row.order_type,
             "daily_target": row.daily_target, "monthly_target": row.monthly_target} for row in rows]


@router.put("/targets")
def save_target(body: TargetWrite, request: Request, user=Depends(principal), db=Depends(get_db)):
    role = db.get(Role, user.role_id).name
    if role == "Team Leader":
        agent = db.get(Agent, body.agent_id)
        if not agent or agent.leader_id != user.id:
            raise HTTPException(404, "Agent not in your team")
    elif role not in {"Administrator", "Operations Manager"}:
        raise HTTPException(403, "Only management or the assigned team leader can set targets")
    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", body.period):
        raise HTTPException(422, "Period must use YYYY-MM")
    assert_agent(db, user, body.agent_id)
    row = db.scalar(select(SalesTarget).where(SalesTarget.agent_id == body.agent_id,
        SalesTarget.period == body.period, SalesTarget.order_type == body.order_type).with_for_update())
    if not row:
        row = SalesTarget(agent_id=body.agent_id, period=body.period, order_type=body.order_type,
                          set_by=user.id)
        db.add(row)
    old = {"daily": row.daily_target, "monthly": row.monthly_target}
    row.daily_target, row.monthly_target, row.set_by = body.daily_target, body.monthly_target, user.id
    db.flush()
    audit(db, user, "Sales Target Set", row.id, body.agent_id, old=old,
          new={"daily": body.daily_target, "monthly": body.monthly_target}, request=request)
    db.commit()
    return {"id": row.id, "saved": True}


class CallWrite(BaseModel):
    stage: Literal["TELE_VERIFICATION", "WELCOME_CALL"]
    outcome: Literal["REACHED", "NO_ANSWER", "RETRY", "PASSED", "FAILED"]
    remark: str = Field(min_length=3, max_length=1000)


@router.get("/calls")
def call_queue(user=Depends(principal), db=Depends(get_db)):
    rows = db.scalars(scoped(db, user, SalesRecord).order_by(SalesRecord.created_at.desc()).limit(1000)).all()
    attempts = db.scalars(select(CallAttempt).where(CallAttempt.sale_id.in_([r.id for r in rows])).order_by(CallAttempt.created_at)).all()
    by_sale = {}
    for attempt in attempts:
        by_sale.setdefault(attempt.sale_id, {}).setdefault(attempt.stage, []).append({
            "id": attempt.id, "outcome": attempt.outcome, "remark": attempt.remark,
            "at": attempt.created_at, "actor": db.get(User, attempt.actor_id).name,
        })
    return [{**sale_view(db, row), "tele_verification": by_sale.get(row.id, {}).get("TELE_VERIFICATION", []),
             "welcome_call": by_sale.get(row.id, {}).get("WELCOME_CALL", [])} for row in rows]


@router.post("/sales/{sale_id}/calls", status_code=201)
def record_call(sale_id: str, body: CallWrite, request: Request, user=Depends(principal), db=Depends(get_db)):
    if "compliance.write" not in permissions(db, user):
        raise HTTPException(403, "Only verification staff can record call outcomes")
    row = db.get(SalesRecord, sale_id)
    if not row or not permitted(db, user, row):
        raise HTTPException(404, "Sale not found")
    attempt = CallAttempt(sale_id=row.id, stage=body.stage, outcome=body.outcome,
                          remark=body.remark.strip(), actor_id=user.id)
    db.add(attempt)
    db.flush()
    audit(db, user, "Sales Call Recorded", row.id, row.agent_id,
          new={"stage": body.stage, "outcome": body.outcome}, request=request)
    db.commit()
    return {"id": attempt.id, "recorded": True}


class StatusFile(BaseModel):
    filename: str = Field(max_length=120)
    content_base64: str = Field(max_length=2_800_000)
    apply: bool = False


def parse_status_file(body):
    try:
        content = base64.b64decode(body.content_base64, validate=True)
        if len(content) > 2_000_000:
            raise ValueError("File exceeds 2 MB")
        if body.filename.lower().endswith(".csv"):
            rows = list(islice(csv.reader(io.StringIO(content.decode("utf-8-sig"))), 503))
        elif body.filename.lower().endswith(".xlsx"):
            with ZipFile(io.BytesIO(content)) as archive:
                members = archive.infolist()
                if len(members) > 100 or sum(member.file_size for member in members) > 20_000_000:
                    raise ValueError("Workbook too large")
            book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            rows = list(islice(book.active.values, 503))
            book.close()
        else:
            raise ValueError("Use CSV or XLSX")
    except Exception:
        raise HTTPException(422, "Could not read the sales status file") from None
    if not 1 <= len(rows) - 1 <= 500 or [str(v or "").strip().lower() for v in rows[0]][:3] != ["sale_id", "current_status", "new_status"]:
        raise HTTPException(422, "Use 1–500 rows with sale_id,current_status,new_status columns")
    return rows[1:]


@router.post("/status-file")
def status_file(body: StatusFile, request: Request, user=Depends(principal), db=Depends(get_db)):
    if db.get(Role, user.role_id).name not in {"Administrator", "Operations Manager"}:
        raise HTTPException(403, "Only backend management can update sales statuses")
    errors, changes, seen = [], [], set()
    for number, values in enumerate(parse_status_file(body), 2):
        if len(values) < 3:
            errors.append(f"Row {number}: expected sale_id, current_status and new_status")
            continue
        sale_id, current_status, status = [str(value or "").strip() for value in values[:3]]
        if sale_id in seen:
            errors.append(f"Row {number}: duplicate sale ID")
            continue
        seen.add(sale_id)
        row = db.get(SalesRecord, sale_id)
        if not row:
            errors.append(f"Row {number}: unmatched sale ID")
        elif current_status != row.status:
            errors.append(f"Row {number}: status changed since download; refresh the file")
        elif status not in SALE_STATUSES:
            errors.append(f"Row {number}: use IN_PROGRESS, CLOSED or CANCELLED")
        else:
            changes.append({"sale_id": sale_id, "from": row.status, "to": status})
    if body.apply and errors:
        raise HTTPException(422, {"errors": errors})
    if body.apply:
        for change in changes:
            row = db.get(SalesRecord, change["sale_id"])
            if row.status != change["to"]:
                row.status, row.status_updated_at = change["to"], now()
                audit(db, user, "Sale Status Imported", row.id, row.agent_id,
                      old={"status": change["from"]}, new={"status": row.status}, request=request)
        db.commit()
    return {"changes": changes, "errors": errors, "applied": body.apply and not errors,
            "file_hash": hashlib.sha256(base64.b64decode(body.content_base64)).hexdigest()}


@router.get("/export")
def export_sales(user=Depends(principal), db=Depends(get_db)):
    from fastapi.responses import Response
    rows = sales(user, db)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["sale_id", "current_status", "new_status", "created_at", "agent", "leader", "branch", "order_type", "customer_name", "plan_name", "request_id"])
    for row in rows:
        values = [row["id"], row["status"], row["status"]] + [row[key] for key in
            ("created_at", "agent", "leader", "branch", "order_type", "customer_name", "plan_name", "request_id")]
        writer.writerow(["'" + str(value) if str(value).startswith(("=", "+", "-", "@")) else value for value in values])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="sales-records.csv"'})
