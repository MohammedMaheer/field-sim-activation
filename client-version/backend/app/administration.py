"""Administrator master-data controls. Historical evidence is never deleted."""
import re
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from .db import Base, Agent, Branch, Customer, FieldTask, Incentive, Movement, Outlet, Role, Sim, User, get_db
from .organization import administrator
from .proposal import valid_amount, valid_period
from .security import principal
from .services import audit, raw

router = APIRouter(prefix="/api/administration", tags=["Administration"])
Kind = Literal["branches", "teams", "outlets", "customers", "inventory", "tasks", "incentives", "agents"]
MODELS = {"branches": Branch, "teams": User, "outlets": Outlet, "customers": Customer,
          "inventory": Sim, "tasks": FieldTask, "incentives": Incentive, "agents": Agent}
FIELDS = {
    "agents": {"name", "email", "employee_id", "target"},
    "branches": {"name"}, "teams": {"name", "email", "branch_id"},
    "outlets": {"name", "area", "branch_id"},
    "customers": {"name", "arabic_name", "mobile", "nationality", "agent_id"},
    "inventory": {"iccid", "serial", "sim_type", "outlet_id", "agent_id"},
    "tasks": {"title", "note", "due_date", "agent_id"},
    "incentives": {"period", "amount", "note", "agent_id"},
}


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    values: dict
    expected: dict = Field(default_factory=dict)
    reason: str = Field(min_length=5, max_length=300)


def locked(db, user):
    administrator(db, user)
    # Serializes admin master-data edits/deletions and organization provisioning.
    db.execute(select(Role).where(Role.id == user.role_id).with_for_update()).scalar_one()


def item(db, kind, record_id):
    row = db.scalar(select(MODELS[kind]).where(MODELS[kind].id == record_id).with_for_update())
    if not row or (kind == "teams" and db.get(Role, row.role_id).name != "Team Leader"):
        raise HTTPException(404, "Record not found")
    return row


def view(row, kind, db):
    values = {k: str(v) if k == "amount" else v for k, v in raw(row).items()}
    if kind == "outlets":
        values.pop("lat", None)
        values.pop("lng", None)
    if kind == "teams":
        values = {k: values[k] for k in ["id", "name", "email", "branch_id"]}
    if kind == "agents":
        values = {"id": row.id, "name": db.get(User, row.user_id).name,
                  "employee_id": row.employee_id, "status": row.status, "target": row.target, "email": db.get(User, row.user_id).email}
    return values


@router.get("/{kind}")
def listing(kind: Kind, user=Depends(principal), db=Depends(get_db)):
    administrator(db, user)
    query = select(MODELS[kind]).order_by(MODELS[kind].created_at.desc())
    if kind == "teams":
        query = query.join(Role).where(Role.name == "Team Leader")
    return [view(row, kind, db) for row in db.scalars(query)]


def validated(db, kind, values, row=None):
    if kind not in FIELDS or not values or set(values) - FIELDS[kind]:
        raise HTTPException(422, "Choose supported fields")
    values = {k: v.strip() if isinstance(v, str) else v for k, v in values.items()}
    for key, value in values.items():
        if (not isinstance(value, (str, int, float)) or
                (key not in {"amount", "target"} and not isinstance(value, str)) or
                len(str(value)) > (300 if kind == "incentives" and key == "note" else 500 if key == "note" else 180)):
            raise HTTPException(422, "Invalid field value")
    merged = {**(view(row, kind, db) if row else {}), **values}
    required = {"agents": ["name", "email", "employee_id", "target"], "branches": ["name"], "teams": ["name", "email", "branch_id"],
                "outlets": ["name", "branch_id"], "customers": ["name", "mobile", "agent_id"],
                "inventory": ["iccid", "serial", "sim_type", "outlet_id"],
                "tasks": ["title", "due_date", "agent_id"], "incentives": ["period", "amount", "agent_id"]}
    if any(not merged.get(key) for key in required[kind]):
        raise HTTPException(422, "Complete the required fields")
    if "name" in values and len(values["name"]) < 2:
        raise HTTPException(422, "Name must contain at least two characters")
    limits = {"name": 120, "area": 120, "arabic_name": 120, "nationality": 80,
              "mobile": 40, "iccid": 60, "serial": 60, "title": 160}
    if any(len(str(v)) > limits[k] for k, v in values.items() if k in limits):
        raise HTTPException(422, "A field exceeds its maximum length")
    for key, model in [("branch_id", Branch), ("outlet_id", Outlet), ("agent_id", Agent)]:
        if merged.get(key) and not db.get(model, merged[key]):
            raise HTTPException(422, "Select a valid assignment")
    if kind in {"branches", "outlets"}:
        query = select(MODELS[kind].id).where(func.lower(MODELS[kind].name) == str(merged["name"]).lower())
        if kind == "outlets":
            query = query.where(Outlet.branch_id == merged["branch_id"])
        if row:
            query = query.where(MODELS[kind].id != row.id)
        if db.scalar(query):
            raise HTTPException(409, "A record with this name already exists")
    if kind == "agents":
        account = db.get(User, row.user_id)
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", merged["email"]):
            raise HTTPException(422, "Enter a valid sign-in email")
        if not re.fullmatch(r"[A-Za-z0-9_-]{2,40}", merged["employee_id"]):
            raise HTTPException(422, "Enter a valid employee ID")
        try:
            target = int(merged["target"])
        except (TypeError, ValueError):
            raise HTTPException(422, "Enter a valid target") from None
        if not 1 <= target <= 1000 or str(target) != str(merged["target"]):
            raise HTTPException(422, "Target must be between 1 and 1000")
        if "target" in values:
            values["target"] = target
        if db.scalar(select(User.id).where(func.lower(User.email) == merged["email"].lower(), User.id != account.id)):
            raise HTTPException(409, "Email already belongs to another account")
        if db.scalar(select(Agent.id).where(func.lower(Agent.employee_id) == merged["employee_id"].lower(), Agent.id != row.id)):
            raise HTTPException(409, "Employee ID already exists")
        if "email" in values:
            values["email"] = values["email"].lower()
    if kind == "teams":
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", merged["email"]):
            raise HTTPException(422, "Enter a valid sign-in email")
        if "email" in values:
            values["email"] = values["email"].lower()
        if db.scalar(select(User.id).where(func.lower(User.email) == merged["email"].lower(), User.id != row.id)):
            raise HTTPException(409, "Email already belongs to another account")
        agents = db.scalars(select(Agent).where(Agent.leader_id == row.id)).all()
        if any(db.get(Outlet, a.outlet_id).branch_id != merged["branch_id"] for a in agents):
            raise HTTPException(409, "Reassign this team's agents before changing its branch")
    if kind == "outlets" and row and merged["branch_id"] != row.branch_id:
        if db.scalar(select(Agent.id).where(Agent.outlet_id == row.id)) or db.scalar(select(Sim.id).where(Sim.outlet_id == row.id)):
            raise HTTPException(409, "Reassign agents and stock before changing the outlet branch")
    if kind == "inventory":
        if row:
            raise HTTPException(422, "Use the inventory editor to change SIM details")
        if merged["sim_type"] not in {"Physical", "eSIM"}:
            raise HTTPException(422, "Select a SIM type")
        if merged.get("agent_id") and db.get(Agent, merged["agent_id"]).outlet_id != merged["outlet_id"]:
            raise HTTPException(422, "Select an agent assigned to this outlet")
        if min(len(merged["iccid"]), len(merged["serial"])) < 3:
            raise HTTPException(422, "Enter valid SIM identifiers")
    if kind == "tasks":
        try:
            date.fromisoformat(merged["due_date"])
        except ValueError:
            raise HTTPException(422, "Enter a valid due date") from None
        if row and row.status == "DONE":
            raise HTTPException(409, "Completed tasks are retained as history")
    if kind == "incentives":
        amount = valid_amount(merged["amount"])
        period = valid_period(merged["period"])
        if "amount" in values:
            values["amount"] = amount
        if "period" in values:
            values["period"] = period
        if row and row.status != "RECORDED":
            raise HTTPException(409, "This incentive is no longer editable")
    return values


@router.post("/{kind}", status_code=201)
def create(kind: Kind, body: Change, request: Request, user=Depends(principal), db=Depends(get_db)):
    locked(db, user)
    if kind in {"branches", "teams", "outlets", "agents"}:
        raise HTTPException(422, "Use field network setup to create this record")
    values = validated(db, kind, body.values)
    if kind == "inventory" and not values.get("agent_id"):
        values.pop("agent_id", None)
    row = MODELS[kind](**values, **({"source": "MANUAL"} if kind == "incentives" else {}))
    db.add(row)
    try:
        db.flush()
        if kind == "inventory":
            db.add(Movement(sim_id=row.id, agent_id=row.agent_id, user_id=user.id,
                            old_status="WAREHOUSE", new_status=row.status or "AVAILABLE", reason=body.reason))
        audit(db, user, "Admin " + kind + " created", row.id, getattr(row, "agent_id", None),
              new=view(row, kind, db), reason=body.reason, request=request)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This identifier already exists") from None
    return view(row, kind, db)


@router.patch("/{kind}/{record_id}")
def update(kind: Kind, record_id: str, body: Change, request: Request, user=Depends(principal), db=Depends(get_db)):
    locked(db, user)
    row = item(db, kind, record_id)
    values = validated(db, kind, body.values, row)
    before = view(row, kind, db)
    for key in values:
        if key not in body.expected or str(before.get(key, "")) != str(body.expected[key]):
            raise HTTPException(409, "Record changed. Reload before editing.")
    for key, value in values.items():
        destination = db.get(User, row.user_id) if kind == "agents" and key in {"name", "email"} else row
        setattr(destination, key, value)
    audit(db, user, "Admin " + kind + " updated", row.id, getattr(row, "agent_id", None),
          old=before, new=view(row, kind, db), reason=body.reason, request=request)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This identifier already exists") from None
    return view(row, kind, db)


@router.delete("/{kind}/{record_id}")
def remove(kind: Kind, record_id: str, body: Change, request: Request, user=Depends(principal), db=Depends(get_db)):
    locked(db, user)
    row = item(db, kind, record_id)
    if kind in {"inventory", "tasks", "incentives"}:
        raise HTTPException(409, "Use stock movements, task completion or incentive history; these records are retained")
    # Inspect every actual foreign-key relationship instead of guessing dependencies.
    target = MODELS[kind].__table__.name + ".id"
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if any(fk.target_fullname == target for fk in column.foreign_keys):
                if db.scalar(select(table.c.id).where(column == row.id).limit(1)):
                    raise HTTPException(409, "This record has linked history or assignments and cannot be deleted")
    snapshot = view(row, kind, db)
    for key, value in body.expected.items():
        if str(snapshot.get(key)) != str(value):
            raise HTTPException(409, "Record changed. Reload before deleting.")
    account = None
    if kind == "agents":
        account = db.get(User, row.user_id)
        for table in Base.metadata.tables.values():
            for column in table.columns:
                if table.name == "agents":
                    continue
                if any(fk.target_fullname == "users.id" for fk in column.foreign_keys):
                    if db.scalar(select(table.c.id).where(column == account.id).limit(1)):
                        raise HTTPException(409, "This account has linked history and cannot be deleted")
    before = view(row, kind, db)
    audit(db, user, "Admin " + kind + " deleted", row.id, getattr(row, "agent_id", None),
          old=before, reason=body.reason, request=request)
    db.delete(row)
    if account:
        db.flush()
        db.delete(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This record now has linked data. Reload and try again.") from None
    return {"deleted": True}
