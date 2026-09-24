"""Proposal-only field tasks and auditable incentive recording."""

import base64
import csv
import hashlib
import io
import re
import uuid
import zipfile
from itertools import islice
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import case, select, text
from openpyxl import load_workbook
from .db import Agent, FieldTask, Incentive, SupportTicket, User, get_db, now
from .security import principal, require, assert_agent, visible_agents
from .services import audit, raw

router = APIRouter(tags=["Proposal field operations"])


def agent_label(db, agent):
    return {"employee_id": agent.employee_id, "agent": db.get(User, agent.user_id).name}


def task_view(db, item):
    return {**raw(item), **agent_label(db, db.get(Agent, item.agent_id))}


def ticket_view(db, item):
    return {**raw(item), **agent_label(db, db.get(Agent, item.agent_id))}


def incentive_view(db, item):
    return {**raw(item), "amount": f"{item.amount:.2f}", **agent_label(db, db.get(Agent, item.agent_id))}


def valid_period(value):
    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", value):
        raise HTTPException(422, "Period must use YYYY-MM")
    return value


def valid_amount(value):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(422, "Enter a valid incentive amount") from None
    if not amount.is_finite() or amount <= 0 or amount > 100000 or amount.as_tuple().exponent < -2:
        raise HTTPException(422, "Amount must be between AED 0.01 and 100,000 with at most two decimals")
    return amount


@router.get("/api/field-tasks")
def tasks(user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    rows = db.scalars(
        select(FieldTask)
        .where(FieldTask.agent_id.in_(visible_agents(db, user)))
        .order_by(case((FieldTask.status == "DONE", 1), else_=0), FieldTask.due_date, FieldTask.created_at.desc())
    ).all()
    return [task_view(db, row) for row in rows]


@router.get("/api/support-tickets")
def tickets(user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    rows = db.scalars(select(SupportTicket).where(SupportTicket.agent_id.in_(visible_agents(db, user))).order_by(SupportTicket.created_at.desc())).all()
    return [ticket_view(db, row) for row in rows]


class TicketCreate(BaseModel):
    agent_id: str
    subject: str = Field(min_length=3, max_length=160)
    message: str = Field(min_length=10, max_length=1000)


@router.post("/api/support-tickets", status_code=201)
def create_ticket(body: TicketCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    assert_agent(db, user, body.agent_id)
    row = SupportTicket(agent_id=body.agent_id, subject=body.subject.strip(), message=body.message.strip())
    db.add(row)
    db.flush()
    audit(db, user, "Support Ticket Opened", row.id, row.agent_id, new={"subject": row.subject}, request=request)
    db.commit()
    return ticket_view(db, row)


class TicketReview(BaseModel):
    status: Literal["IN_PROGRESS", "RESOLVED"]
    response: str = Field(min_length=5, max_length=1000)


@router.patch("/api/support-tickets/{ticket_id}")
def review_ticket(ticket_id: str, body: TicketReview, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "support.write")
    row = db.scalar(select(SupportTicket).where(SupportTicket.id == ticket_id).with_for_update())
    if not row:
        raise HTTPException(404, "Ticket not found")
    assert_agent(db, user, row.agent_id)
    if row.status == "RESOLVED":
        raise HTTPException(409, "Ticket is already resolved")
    old = row.status
    row.status = body.status
    row.response = body.response.strip()
    audit(db, user, "Support Ticket Updated", row.id, row.agent_id, old={"status": old}, new={"status": row.status}, request=request)
    db.commit()
    return ticket_view(db, row)


class TaskCreate(BaseModel):
    agent_id: str
    title: str = Field(min_length=3, max_length=160)
    note: str = Field(default="", max_length=500)
    due_date: str


@router.post("/api/field-tasks", status_code=201)
def create_task(body: TaskCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "task.write")
    assert_agent(db, user, body.agent_id)
    try:
        date.fromisoformat(body.due_date)
    except ValueError:
        raise HTTPException(422, "Enter a valid due date") from None
    row = FieldTask(agent_id=body.agent_id, title=body.title.strip(), note=body.note.strip(), due_date=body.due_date)
    db.add(row)
    db.flush()
    audit(db, user, "Field Task Assigned", row.id, row.agent_id, new={"title": row.title, "due_date": row.due_date}, request=request)
    db.commit()
    return task_view(db, row)


class TaskUpdate(BaseModel):
    status: Literal["OPEN", "IN_PROGRESS", "DONE"]


@router.patch("/api/field-tasks/{task_id}")
def update_task(task_id: str, body: TaskUpdate, request: Request, user=Depends(principal), db=Depends(get_db)):
    row = db.scalar(select(FieldTask).where(FieldTask.id == task_id).with_for_update())
    if not row:
        raise HTTPException(404, "Task not found")
    assert_agent(db, user, row.agent_id)
    if row.status == "DONE" or row.status == body.status:
        raise HTTPException(409, "This task cannot make that transition")
    if (row.status, body.status) not in {("OPEN", "IN_PROGRESS"), ("OPEN", "DONE"), ("IN_PROGRESS", "DONE")}:
        raise HTTPException(409, "Invalid task transition")
    before = row.status
    row.status = body.status
    if body.status == "DONE":
        row.completed_at = now()
    audit(db, user, "Field Task Updated", row.id, row.agent_id, old={"status": before}, new={"status": row.status}, request=request)
    db.commit()
    return task_view(db, row)


@router.get("/api/incentives")
def incentives(user=Depends(principal), db=Depends(get_db), period: str | None = None):
    require(db, user, "read")
    query = select(Incentive).where(Incentive.agent_id.in_(visible_agents(db, user)))
    if period:
        query = query.where(Incentive.period == valid_period(period))
    rows = db.scalars(query.order_by(Incentive.created_at.desc())).all()
    return [incentive_view(db, row) for row in rows]


class IncentiveCreate(BaseModel):
    agent_id: str
    period: str
    amount: str
    note: str = Field(default="", max_length=300)


@router.post("/api/incentives", status_code=201)
def create_incentive(body: IncentiveCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "incentive.write")
    assert_agent(db, user, body.agent_id)
    row = Incentive(agent_id=body.agent_id, period=valid_period(body.period), amount=valid_amount(body.amount), note=body.note.strip(), source="MANUAL")
    db.add(row)
    db.flush()
    audit(db, user, "Incentive Recorded", row.id, row.agent_id, new={"period": row.period, "amount": str(row.amount)}, request=request)
    db.commit()
    return incentive_view(db, row)


class IncentiveUpload(BaseModel):
    filename: str = Field(max_length=120)
    content_base64: str = Field(max_length=2_800_000)


@router.post("/api/incentives/import", status_code=201)
def import_incentives(body: IncentiveUpload, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "incentive.write")
    suffix = body.filename.lower().rsplit(".", 1)[-1]
    if suffix not in {"csv", "xlsx"}:
        raise HTTPException(422, "Upload CSV or XLSX only")
    try:
        content = base64.b64decode(body.content_base64, validate=True)
        if len(content) > 2_000_000:
            raise ValueError("File exceeds 2 MB")
        batch = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user.id}:{hashlib.sha256(content).hexdigest()}"))
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:batch, 0))"), {"batch": batch})
        previous = db.scalars(select(Incentive).where(Incentive.batch_id == batch)).all()
        if previous:
            return {"batch_id": batch, "count": len(previous), "rows": [incentive_view(db, row) for row in previous], "already_imported": True}
        if suffix == "csv":
            parsed = list(islice(csv.reader(io.StringIO(content.decode("utf-8-sig", errors="strict"))), 503))
        else:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 10_000_000:
                    raise ValueError("Expanded workbook exceeds limit")
            book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            parsed = list(islice(book.active.values, 503))
            book.close()
    except Exception:
        raise HTTPException(422, "Could not read this CSV/XLSX file") from None
    if not parsed or [str(x or "").strip().lower() for x in parsed[0]] != ["employee_id", "period", "amount", "note"]:
        raise HTTPException(422, "Columns must be employee_id, period, amount, note")
    if not 1 <= len(parsed) - 1 <= 500:
        raise HTTPException(422, "Upload 1 to 500 incentive rows")
    agents = {a.employee_id: a for a in db.scalars(select(Agent).where(Agent.id.in_(visible_agents(db, user))))}
    validated = []
    for number, values in enumerate(parsed[1:], 2):
        if len(values) != 4:
            raise HTTPException(422, f"Row {number}: expected four columns")
        employee, period, amount, note = [str(v if v is not None else "").strip() for v in values]
        if employee not in agents or len(note) > 300:
            raise HTTPException(422, f"Row {number}: unknown agent or note too long")
        try:
            validated.append((agents[employee], valid_period(period), valid_amount(amount), note))
        except HTTPException as exc:
            raise HTTPException(422, f"Row {number}: {exc.detail}") from None
    result = []
    for agent, period, amount, note in validated:
        row = Incentive(agent_id=agent.id, period=period, amount=amount, note=note, source="EXCEL" if suffix == "xlsx" else "CSV", batch_id=batch)
        db.add(row)
        db.flush()
        audit(db, user, "Incentive Imported", row.id, agent.id, new={"period": period, "amount": str(amount), "batch_id": batch}, request=request)
        result.append(incentive_view(db, row))
    db.commit()
    return {"batch_id": batch, "count": len(result), "rows": result}


@router.get("/api/incentives/export")
def export_incentives(request: Request, user=Depends(principal), db=Depends(get_db), period: str | None = None):
    require(db, user, "report.read")
    rows = incentives(user, db, period)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Employee ID", "Agent", "Period", "Amount AED", "Source", "Status", "Note"])
    for row in rows:
        note = row["note"]
        if note.lstrip().startswith(("=", "+", "-", "@")):
            note = "'" + note
        writer.writerow([row["employee_id"], row["agent"], row["period"], row["amount"], row["source"], row["status"], note])
    audit(db, user, "Incentives Exported", period or "all", request=request)
    db.commit()
    return Response(out.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="incentives.csv"'})
