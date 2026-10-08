"""Branch stock, movement history and shortage alerts, including existing SIM stock."""

import csv
import io
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import Field
from .validation import BusinessInput
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from openpyxl import Workbook

from .db import Audit, Agent, Branch, FieldAsset, FieldAssetMovement, FieldAssetRequest, Movement, Outlet, Role, Session, Sim, SimProgress, StockThreshold, User, get_db, now
from .security import active_agent, agent_for_update, assert_agent, permissions, principal, visible_agents
from .services import audit

router = APIRouter(prefix="/api/field-assets", tags=["Field assets"])
Status = Literal["AVAILABLE", "ASSIGNED", "RETURNED", "DAMAGED", "LOST", "CONSUMED", "RETIRED"]
MANAGERS = {"Administrator", "Operations Manager", "Inventory Manager"}


def role(db, user):
    return db.get(Role, user.role_id).name


def may_manage(db, user):
    if role(db, user) not in MANAGERS:
        raise HTTPException(403, "Only stock managers can change field assets")


def asset_scope(db, user):
    if "read" not in permissions(db, user):
        raise HTTPException(403, "Your role cannot view stock")
    query = select(FieldAsset)
    name = role(db, user)
    if name == "Field Agent":
        agent_ids = visible_agents(db, user)
        branch_ids = visible_branches(db, user)
        query = query.where(or_(FieldAsset.agent_id.in_(agent_ids),
                                FieldAsset.branch_id.in_(branch_ids) & FieldAsset.agent_id.is_(None)))
    elif name == "Team Leader":
        query = query.where(FieldAsset.branch_id.in_(visible_branches(db, user)))
    elif name == "Branch Manager":
        query = query.where(FieldAsset.branch_id == user.branch_id)
    elif name in {"Tele Verification Officer", "Welcome Call Officer"}:
        raise HTTPException(403, "Your role cannot view stock")
    return query


def request_scope(db, user):
    if "read" not in permissions(db, user):
        raise HTTPException(403, "Your role cannot view stock requests")
    query = select(FieldAssetRequest)
    name = role(db, user)
    if name in {"Field Agent", "Team Leader"}:
        query = query.where(FieldAssetRequest.agent_id.in_(visible_agents(db, user)))
    elif name == "Branch Manager":
        query = query.where(FieldAssetRequest.branch_id == user.branch_id)
    elif name in {"Tele Verification Officer", "Welcome Call Officer"}:
        raise HTTPException(403, "Your role cannot view stock requests")
    return query


def visible_branches(db, user):
    if "read" not in permissions(db, user):
        return []
    name = role(db, user)
    if name in {"Administrator", "Operations Manager", "Inventory Manager", "Compliance Officer", "Sales Manager"}:
        return list(db.scalars(select(Branch.id)))
    if name == "Field Agent":
        agent = db.scalar(select(Agent).where(Agent.user_id == user.id))
        return [db.get(Outlet, agent.outlet_id).branch_id] if agent else []
    if name in {"Team Leader", "Branch Manager"}:
        return [user.branch_id] if user.branch_id else []
    return []


def view(db, row):
    agent = db.get(Agent, row.agent_id) if row.agent_id else None
    return {"id": row.id, "category": row.category, "label": row.label,
            "serial": row.serial or "Not recorded", "quantity": row.quantity,
            "status": row.status, "branch_id": row.branch_id,
            "branch": db.get(Branch, row.branch_id).name,
            "agent_id": row.agent_id, "agent": db.get(User, agent.user_id).name if agent else "Unassigned",
            "note": row.note, "warehouse": row.warehouse, "batch": row.batch,
            "size": row.size, "condition": row.condition, "created_at": row.created_at}


@router.get("")
def assets(user=Depends(principal), db=Depends(get_db)):
    rows = db.scalars(asset_scope(db, user).order_by(FieldAsset.created_at.desc()).limit(1000)).all()
    return [view(db, row) for row in rows]


class AssetCreate(BusinessInput):
    category: str = Field(min_length=2, max_length=40, pattern=r"^[A-Z][A-Z0-9_]*$")
    label: str = Field(min_length=2, max_length=160)
    serial: str = Field(default="", max_length=120)
    quantity: int = Field(ge=1, le=10000)
    branch_id: str
    note: str = Field(default="", max_length=500)
    warehouse: str = Field(default="", max_length=100)
    batch: str = Field(default="", max_length=100)
    size: str = Field(default="", max_length=40)
    condition: str = Field(default="", max_length=100)


@router.post("", status_code=201)
def create_asset(body: AssetCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    if not db.get(Branch, body.branch_id):
        raise HTTPException(404, "Branch not found")
    from .branch_lifecycle import active_branch
    active_branch(db, body.branch_id)
    serial = body.serial.strip() or None
    if serial and body.quantity != 1:
        raise HTTPException(422, "A serialised item must have quantity one")
    if serial and db.scalar(select(FieldAsset.id).where(FieldAsset.serial == serial)):
        raise HTTPException(409, "Serial already recorded")
    row = FieldAsset(category=body.category, label=body.label.strip(), serial=serial,
                     quantity=body.quantity, branch_id=body.branch_id, status="AVAILABLE", note=body.note.strip(),
                     warehouse=body.warehouse.strip(), batch=body.batch.strip(), size=body.size.strip(), condition=body.condition.strip())
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Serial already recorded") from None
    db.add(FieldAssetMovement(asset_id=row.id, from_branch_id=row.branch_id,
        to_branch_id=row.branch_id, actor_id=user.id, quantity_delta=row.quantity,
        reason="Stock received"))
    audit(db, user, "Field Asset Added", row.id, new={"category": row.category, "branch_id": row.branch_id}, request=request)
    db.commit()
    return view(db, row)


class AssetChange(BusinessInput):
    branch_id: str
    agent_id: str = ""
    status: Status
    reason: str = Field(min_length=5, max_length=300)
    condition: str | None = Field(default=None, max_length=100)
    warehouse: str | None = Field(default=None, max_length=100)
    batch: str | None = Field(default=None, max_length=100)
    size: str | None = Field(default=None, max_length=40)


@router.patch("/{asset_id}")
def move_asset(asset_id: str, body: AssetChange, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    row = db.scalar(select(FieldAsset).where(FieldAsset.id == asset_id).with_for_update())
    if not row:
        raise HTTPException(404, "Asset not found")
    if not db.get(Branch, body.branch_id):
        raise HTTPException(404, "Branch not found")
    from .branch_lifecycle import active_branch
    if body.branch_id != row.branch_id or body.status in {"AVAILABLE", "ASSIGNED"}:
        active_branch(db, body.branch_id)
    agent_id = body.agent_id.strip() or None
    if agent_id:
        agent = active_agent(db, agent_id) if agent_id != row.agent_id or body.status == "ASSIGNED" else db.get(Agent, agent_id)
        outlet = db.get(Outlet, agent.outlet_id) if agent else None
        if not outlet or outlet.branch_id != body.branch_id:
            raise HTTPException(422, "Agent must belong to the selected branch")
    if body.status == "ASSIGNED" and not agent_id:
        raise HTTPException(422, "Assign an agent for this status")
    if body.status in {"AVAILABLE", "RETURNED", "RETIRED"} and agent_id:
        raise HTTPException(422, "This status cannot have an assigned agent")
    old = {"branch_id": row.branch_id, "agent_id": row.agent_id, "status": row.status}
    metadata_changed = any(getattr(body, name) is not None and getattr(body, name).strip() != getattr(row, name)
                           for name in ("condition", "warehouse", "batch", "size"))
    if old == {"branch_id": body.branch_id, "agent_id": agent_id, "status": body.status} and not metadata_changed:
        raise HTTPException(409, "No asset change to record")
    db.add(FieldAssetMovement(asset_id=row.id, from_branch_id=row.branch_id,
        to_branch_id=body.branch_id, from_agent_id=row.agent_id, to_agent_id=agent_id,
        actor_id=user.id, reason=body.reason.strip()))
    row.branch_id, row.agent_id, row.status = body.branch_id, agent_id, body.status
    for name in ("condition", "warehouse", "batch", "size"):
        if getattr(body, name) is not None:
            old[name] = getattr(row, name)
            setattr(row, name, getattr(body, name).strip())
    audit(db, user, "Field Asset Moved", row.id, old=old,
          new={"branch_id": row.branch_id, "agent_id": row.agent_id, "status": row.status,
               **{name: getattr(row, name) for name in ("condition", "warehouse", "batch", "size")}},
          reason=body.reason.strip(), request=request)
    db.commit()
    return view(db, row)


class BulkIssue(BusinessInput):
    quantity: int = Field(ge=1, le=10000)
    agent_id: str
    reason: str = Field(min_length=5, max_length=300)


@router.post("/{asset_id}/issue", status_code=201)
def issue_bulk(asset_id: str, body: BulkIssue, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    row = db.scalar(select(FieldAsset).where(FieldAsset.id == asset_id).with_for_update())
    agent = active_agent(db, body.agent_id)
    outlet = db.get(Outlet, agent.outlet_id) if agent else None
    if not row:
        raise HTTPException(404, "Asset not found")
    if not outlet or outlet.branch_id != row.branch_id:
        raise HTTPException(422, "Agent must belong to the stock branch")
    from .branch_lifecycle import active_branch
    active_branch(db, row.branch_id)
    if row.serial or row.status != "AVAILABLE" or row.agent_id or body.quantity > row.quantity:
        raise HTTPException(409, "Choose unassigned bulk stock within its available balance")
    row.quantity -= body.quantity
    issued = FieldAsset(category=row.category, label=row.label, quantity=body.quantity,
                        branch_id=row.branch_id, agent_id=agent.id, status="ASSIGNED", note=row.note,
                        warehouse=row.warehouse, batch=row.batch, size=row.size, condition=row.condition)
    db.add(issued)
    db.flush()
    for stock, delta in ((row, -body.quantity), (issued, body.quantity)):
        db.add(FieldAssetMovement(asset_id=stock.id, from_branch_id=row.branch_id,
            to_branch_id=row.branch_id, to_agent_id=agent.id if stock is issued else None,
            actor_id=user.id, quantity_delta=delta, reason=body.reason.strip()))
    audit(db, user, "Bulk Stock Issued", issued.id, agent.id,
          new={"source_asset_id": row.id, "quantity": body.quantity}, reason=body.reason.strip(), request=request)
    db.commit()
    return view(db, issued)


class QuantityAdjustment(BusinessInput):
    delta: int = Field(ge=-10000, le=10000)
    reason: str = Field(min_length=5, max_length=300)


@router.post("/{asset_id}/adjust")
def adjust_asset(asset_id: str, body: QuantityAdjustment, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    row = db.scalar(select(FieldAsset).where(FieldAsset.id == asset_id).with_for_update())
    if not row:
        raise HTTPException(404, "Asset not found")
    from .branch_lifecycle import active_branch
    if body.delta > 0:
        active_branch(db, row.branch_id)
    if row.serial or row.agent_id or row.status != "AVAILABLE":
        raise HTTPException(422, "Only unassigned bulk stock can be adjusted")
    if not body.delta or row.quantity + body.delta < 0:
        raise HTTPException(422, "Enter a non-zero adjustment within the available balance")
    previous = row.quantity
    row.quantity += body.delta
    db.add(FieldAssetMovement(asset_id=row.id, from_branch_id=row.branch_id,
        to_branch_id=row.branch_id, actor_id=user.id, quantity_delta=body.delta,
        reason=body.reason.strip()))
    audit(db, user, "Field Stock Adjusted", row.id, old={"quantity": previous},
          new={"quantity": row.quantity}, reason=body.reason.strip(), request=request)
    db.commit()
    return view(db, row)


@router.get("/{asset_id}/history")
def history(asset_id: str, user=Depends(principal), db=Depends(get_db)):
    row = db.get(FieldAsset, asset_id)
    if not row or row.id not in db.scalars(asset_scope(db, user).with_only_columns(FieldAsset.id)).all():
        raise HTTPException(404, "Asset not found")
    moves = db.scalars(select(FieldAssetMovement).where(FieldAssetMovement.asset_id == asset_id).order_by(FieldAssetMovement.created_at.desc())).all()
    return [{"at": move.created_at, "from_branch_id": move.from_branch_id,
             "to_branch_id": move.to_branch_id, "from_agent_id": move.from_agent_id,
             "to_agent_id": move.to_agent_id, "actor": db.get(User, move.actor_id).name,
             "quantity_delta": move.quantity_delta, "reason": move.reason} for move in moves]


def summary_rows(db, user):
    branch_ids = visible_branches(db, user)
    if not branch_ids:
        return []
    balances = {}
    for asset in db.scalars(select(FieldAsset).where(FieldAsset.branch_id.in_(branch_ids))):
        key = (asset.branch_id, asset.category)
        bucket = balances.setdefault(key, {"available": 0, "assigned": 0, "reserved": 0,
                                            "damaged": 0, "consumed": 0, "returned": 0, "lost": 0, "retired": 0})
        field = {"AVAILABLE": "available", "ASSIGNED": "assigned", "DAMAGED": "damaged",
                 "RETURNED": "returned", "LOST": "lost", "CONSUMED": "consumed", "RETIRED": "retired"}.get(asset.status)
        if field:
            bucket[field] += asset.quantity
    outlets = {outlet.id: outlet.branch_id for outlet in db.scalars(select(Outlet).where(Outlet.branch_id.in_(branch_ids)))}
    if outlets:
        for sim in db.scalars(select(Sim).where(Sim.outlet_id.in_(outlets))):
            key = (outlets[sim.outlet_id], "SIM:" + sim.sim_type.upper() + ":" + sim.business_category)
            bucket = balances.setdefault(key, {"available": 0, "assigned": 0, "reserved": 0,
                                                "damaged": 0, "consumed": 0, "returned": 0, "lost": 0, "retired": 0})
            field = {"AVAILABLE": "available", "ASSIGNED TO AGENT": "assigned",
                     "RESERVED": "reserved", "ACTIVATED": "consumed", "DAMAGED": "damaged", "RETURNED": "returned", "RETIRED": "retired"}.get(sim.status)
            if field:
                bucket[field] += 1
    thresholds = {(row.branch_id, row.category): row.minimum for row in db.scalars(
        select(StockThreshold).where(StockThreshold.branch_id.in_(branch_ids)))}
    for key in thresholds:
        balances.setdefault(key, {"available": 0, "assigned": 0, "reserved": 0,
                                  "damaged": 0, "consumed": 0, "returned": 0, "lost": 0, "retired": 0})
    return [{"branch_id": branch_id, "branch": db.get(Branch, branch_id).name,
             "category": category, **counts, "minimum": thresholds.get((branch_id, category), 0),
             "low_stock": thresholds.get((branch_id, category), 0) > 0 and counts["available"] < thresholds[(branch_id, category)]}
            for (branch_id, category), counts in sorted(balances.items())]


@router.get("/report/summary")
def stock_summary(user=Depends(principal), db=Depends(get_db)):
    return summary_rows(db, user)


@router.get("/report/checklist")
def return_checklist(agent_id: str = "", branch_id: str = "", user=Depends(principal), db=Depends(get_db)):
    """Live return/transfer checklist. No departure or branch closure is claimed by this view."""
    branches = visible_branches(db, user)
    if role(db, user) == "Field Agent" and not agent_id:
        raise HTTPException(403, "Select your own agent assignment")
    if not agent_id and not branch_id:
        raise HTTPException(422, "Choose an agent or branch")
    if branch_id and branch_id not in branches or agent_id and agent_id not in visible_agents(db, user):
        raise HTTPException(404, "Assignment not found")
    query = asset_scope(db, user).where(FieldAsset.status.in_(["AVAILABLE", "ASSIGNED", "DAMAGED", "LOST"]), FieldAsset.quantity > 0)
    if branch_id:
        query = query.where(FieldAsset.branch_id == branch_id)
    if agent_id:
        query = query.where(FieldAsset.agent_id == agent_id)
    outstanding = [view(db, row) for row in db.scalars(query)]
    sim_query = select(Sim).join(Outlet).where(Outlet.branch_id.in_(branches), Sim.status.in_(["AVAILABLE", "ASSIGNED TO AGENT", "RESERVED", "DAMAGED", "BLOCKED"]))
    if branch_id:
        sim_query = sim_query.where(Outlet.branch_id == branch_id)
    if agent_id:
        sim_query = sim_query.where(Sim.agent_id == agent_id)
    for sim in db.scalars(sim_query):
        outstanding.append({"id": sim.id, "category": "SIM:" + sim.sim_type.upper() + ":" + sim.business_category, "label": "SIM",
            "serial": sim.serial, "quantity": 1, "status": sim.status, "branch": db.get(Branch, db.get(Outlet, sim.outlet_id).branch_id).name,
            "agent": db.get(User, db.get(Agent, sim.agent_id).user_id).name if sim.agent_id else "Unassigned"})
    return {"outstanding": outstanding, "clear": not outstanding,
            "next_action": "All stock accounted for" if not outstanding else "Return, transfer or write off outstanding stock"}


class AgentTransfer(BusinessInput):
    branch_id: str
    stock_action: Literal["RETURN", "TRANSFER"]
    reason: str = Field(min_length=5, max_length=300)


@router.post("/agents/{agent_id}/transfer")
def transfer_agent(agent_id: str, body: AgentTransfer, request: Request, user=Depends(principal), db=Depends(get_db)):
    if role(db, user) not in {"Administrator", "Operations Manager"}:
        raise HTTPException(403, "Only administrators and backend staff can transfer agents")
    agent = agent_for_update(db, agent_id)
    outlet = db.scalar(select(Outlet).where(Outlet.branch_id == body.branch_id).order_by(Outlet.created_at).limit(1))
    if not agent or not outlet:
        raise HTTPException(404, "Agent or destination branch not found")
    from .branch_lifecycle import active_branch
    active_branch(db, body.branch_id)
    previous = db.get(Outlet, agent.outlet_id).branch_id
    if previous == body.branch_id or agent.employment_status != "ACTIVE":
        raise HTTPException(409, "Choose a different branch for an active agent")
    sims = db.scalars(select(Sim).where(Sim.agent_id == agent.id, Sim.status.not_in(["ACTIVATED", "RETURNED", "RETIRED"])).with_for_update()).all()
    if any(sim.status not in {"AVAILABLE", "ASSIGNED TO AGENT"} or db.scalar(select(SimProgress.id).where(SimProgress.sim_id == sim.id,
                  SimProgress.stage.not_in(["ACTIVATED", "CANCELLED", "REJECTED"]))) for sim in sims):
        raise HTTPException(409, "Resolve active or damaged SIM stock before transferring this agent")
    # Accounted-for stock remains with its original branch and assignee as history.
    items = db.scalars(select(FieldAsset).where(FieldAsset.agent_id == agent.id,
        FieldAsset.status.not_in(["CONSUMED", "RETURNED", "RETIRED"])).with_for_update()).all()
    if any(item.status != "ASSIGNED" for item in items):
        raise HTTPException(409, "Return or write off damaged/lost equipment before transferring this agent")
    leader = db.scalar(select(User).join(Role).where(Role.name == "Team Leader", User.branch_id == body.branch_id))
    if not leader:
        raise HTTPException(409, "Assign the destination branch team leader first")
    for item in items:
        destination = body.branch_id if body.stock_action == "TRANSFER" else item.branch_id
        assignee = agent.id if body.stock_action == "TRANSFER" else None
        db.add(FieldAssetMovement(asset_id=item.id, from_branch_id=item.branch_id, to_branch_id=destination,
            from_agent_id=agent.id, to_agent_id=assignee, actor_id=user.id, reason=body.reason.strip()))
        item.branch_id, item.agent_id = destination, assignee
        item.status = "ASSIGNED" if assignee else "AVAILABLE"
    for sim in sims:
        old = sim.status
        if body.stock_action == "TRANSFER":
            sim.outlet_id = outlet.id
        else:
            sim.agent_id, sim.assigned_at, sim.status = None, None, "AVAILABLE"
        db.add(Movement(sim_id=sim.id, agent_id=sim.agent_id, user_id=user.id, old_status=old,
                        new_status=sim.status, reason=body.reason.strip()))
    agent.outlet_id, agent.leader_id = outlet.id, leader.id
    agent.assignment_effective_at = now()
    account = db.get(User, agent.user_id)
    account.branch_id = body.branch_id
    for session in db.scalars(select(Session).where(Session.user_id == agent.user_id)):
        session.revoked = True
    audit(db, user, "Agent Branch Transferred", agent.id, agent.id,
          old={"branch_id": previous}, new={"branch_id": body.branch_id, "stock_action": body.stock_action},
          reason=body.reason.strip(), request=request)
    db.commit()
    return {"transferred": True, "branch_id": body.branch_id, "agent_id": agent.id}


class AgentExit(BusinessInput):
    reason: str = Field(min_length=5, max_length=300)


@router.post("/agents/{agent_id}/exit")
def exit_agent(agent_id: str, body: AgentExit, request: Request, user=Depends(principal), db=Depends(get_db)):
    if role(db, user) != "Administrator":
        raise HTTPException(403, "Only administrators can close agent access")
    agent = agent_for_update(db, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    if not return_checklist(agent_id=agent_id, user=user, db=db)["clear"]:
        raise HTTPException(409, "Complete the stock return checklist before closing agent access")
    if agent.employment_status != "ACTIVE":
        raise HTTPException(409, "Agent access is already closed")
    agent.employment_status = "EXITED"
    for session in db.scalars(select(Session).where(Session.user_id == agent.user_id)):
        session.revoked = True
    audit(db, user, "Agent Access Closed", agent.id, agent.id, reason=body.reason.strip(), request=request)
    db.commit()
    return {"closed": True, "history_preserved": True}


class ThresholdWrite(BusinessInput):
    branch_id: str
    category: str = Field(min_length=2, max_length=40)
    minimum: int = Field(ge=0, le=100000)


@router.put("/report/threshold")
def set_threshold(body: ThresholdWrite, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    if not db.get(Branch, body.branch_id):
        raise HTTPException(404, "Branch not found")
    row = db.scalar(select(StockThreshold).where(StockThreshold.branch_id == body.branch_id,
                    StockThreshold.category == body.category).with_for_update())
    if not row:
        row = StockThreshold(branch_id=body.branch_id, category=body.category, actor_id=user.id)
        db.add(row)
    old = row.minimum
    row.minimum, row.actor_id = body.minimum, user.id
    db.flush()
    audit(db, user, "Stock Threshold Set", row.id, old={"minimum": old},
          new={"minimum": row.minimum, "branch_id": row.branch_id, "category": row.category}, request=request)
    db.commit()
    return {"id": row.id, "minimum": row.minimum}


@router.get("/report/movements")
def movement_report(category: str = "", branch_id: str = "", agent_id: str = "", start: datetime | None = None,
                    end: datetime | None = None, user=Depends(principal), db=Depends(get_db)):
    branch_ids = visible_branches(db, user)
    if branch_id:
        branch_ids = [item for item in branch_ids if item == branch_id]
    if not branch_ids:
        return []
    result = []
    if agent_id and agent_id not in visible_agents(db, user):
        return []
    query = select(FieldAssetMovement).where(or_(FieldAssetMovement.to_branch_id.in_(branch_ids),
                                                FieldAssetMovement.from_branch_id.in_(branch_ids)))
    if role(db, user) == "Field Agent":
        owned = visible_agents(db, user)
        query = query.where(or_(FieldAssetMovement.to_agent_id.in_(owned), FieldAssetMovement.from_agent_id.in_(owned),
                               FieldAssetMovement.to_agent_id.is_(None) & FieldAssetMovement.from_agent_id.is_(None)))
    if agent_id:
        query = query.where(or_(FieldAssetMovement.to_agent_id == agent_id, FieldAssetMovement.from_agent_id == agent_id))
    if start:
        query = query.where(FieldAssetMovement.created_at >= start)
    if end:
        query = query.where(FieldAssetMovement.created_at <= end)
    movements = db.scalars(query.order_by(FieldAssetMovement.created_at.desc()).limit(1000)).all()
    for move in movements:
        asset = db.get(FieldAsset, move.asset_id)
        if not asset or category and asset.category != category:
            continue
        result.append({"at": move.created_at, "category": asset.category, "item": asset.label,
                       "serial": asset.serial or "", "branch": db.get(Branch, move.to_branch_id).name,
                       "agent": db.get(User, db.get(Agent, move.to_agent_id).user_id).name if move.to_agent_id else "Unassigned",
                       "from_branch": db.get(Branch, move.from_branch_id).name,
                       "warehouse": asset.warehouse, "batch": asset.batch,
                       "quantity_delta": move.quantity_delta, "reason": move.reason,
                       "actor": db.get(User, move.actor_id).name})
    sim_moves = db.scalars(select(Movement).order_by(Movement.created_at.desc()).limit(1000)).all()
    for move in sim_moves:
        sim = db.get(Sim, move.sim_id)
        if not sim:
            continue
        outlet = db.get(Outlet, sim.outlet_id)
        sim_category = "SIM:" + sim.sim_type.upper() + ":" + sim.business_category
        if outlet.branch_id not in branch_ids or category and category != sim_category:
            continue
        if role(db, user) == "Field Agent" and move.agent_id and move.agent_id not in visible_agents(db, user):
            continue
        if agent_id and move.agent_id != agent_id or start and move.created_at < start.replace(tzinfo=None) or end and move.created_at > end.replace(tzinfo=None):
            continue
        result.append({"at": move.created_at, "category": sim_category, "item": "SIM",
                       "serial": sim.serial, "branch": db.get(Branch, outlet.branch_id).name,
                       "agent": db.get(User, db.get(Agent, move.agent_id).user_id).name if move.agent_id else "Unassigned",
                       "quantity_delta": -1 if move.new_status == "ACTIVATED" else 0,
                       "from_branch": "Not recorded", "warehouse": "", "batch": "",
                       "reason": f"{move.old_status} → {move.new_status}: {move.reason}",
                       "actor": db.get(User, move.user_id).name})
    return sorted(result, key=lambda row: row["at"], reverse=True)[:1000]


def csv_safe(value):
    value = str(value if value is not None else "")
    return "'" + value if value.startswith(("=", "+", "-", "@")) else value


@router.get("/report/export")
def export_stock(kind: Literal["summary", "movements", "stock", "requests"] = "summary", format: Literal["csv", "xlsx"] = "csv",
                 branch_id: str = "", category: str = "", status: str = "", agent_id: str = "",
                 start: datetime | None = None, end: datetime | None = None, user=Depends(principal), db=Depends(get_db)):
    if kind == "summary":
        rows = summary_rows(db, user)
        columns = ["branch", "category", "available", "assigned", "reserved", "damaged", "lost", "consumed", "returned", "retired", "minimum", "low_stock"]
    elif kind == "movements":
        rows = movement_report(category=category, branch_id=branch_id, agent_id=agent_id, start=start, end=end, user=user, db=db)
        columns = ["at", "from_branch", "branch", "category", "item", "serial", "agent", "warehouse", "batch", "quantity_delta", "reason", "actor"]
    elif kind == "stock":
        rows = assets(user, db)
        columns = ["created_at", "branch", "category", "label", "serial", "quantity", "agent", "status", "warehouse", "batch", "size", "condition", "note"]
    else:
        rows = requests(user, db)
        columns = ["created_at", "branch", "category", "agent", "quantity", "urgency", "reason", "status"]
    if kind != "movements":
        rows = [row for row in rows if (not branch_id or row["branch_id"] == branch_id)
                and (not category or row["category"] == category) and (kind == "summary" or not status or row.get("status") == status)
                and (kind == "summary" or not agent_id or row.get("agent_id") == agent_id)
                and (not start or not row.get("created_at") or row["created_at"] >= start.replace(tzinfo=None))
                and (not end or not row.get("created_at") or row["created_at"] <= end.replace(tzinfo=None))]
    if format == "xlsx":
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Stock report"
        sheet.append(columns)
        for row in rows:
            sheet.append([csv_safe(row.get(column, "")) for column in columns])
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        output = io.BytesIO()
        workbook.save(output)
        return Response(output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="stock-{kind}.xlsx"'})
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in rows:
        writer.writerow([csv_safe(row.get(column, "")) for column in columns])
    return Response(output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="stock-{kind}.csv"'})


class RequestCreate(BusinessInput):
    agent_id: str
    category: str = Field(min_length=2, max_length=40, pattern=r"^[A-Z][A-Z0-9_]*$")
    quantity: int = Field(ge=1, le=10000)
    reason: str = Field(min_length=5, max_length=300)
    urgency: Literal["NORMAL", "URGENT"] = "NORMAL"


@router.get("/requests/list")
def requests(user=Depends(principal), db=Depends(get_db)):
    rows = db.scalars(request_scope(db, user).order_by(FieldAssetRequest.created_at.desc()).limit(1000)).all()
    responses = {}
    for event in db.scalars(select(Audit).where(Audit.entity.in_([row.id for row in rows]), Audit.action == "Field Asset Request Updated").order_by(Audit.created_at.desc())):
        responses.setdefault(event.entity, {"response": event.reason, "responded_by": event.actor, "responded_at": event.created_at})
    return [{"id": row.id, "agent_id": row.agent_id, **responses.get(row.id, {}),
             "agent": db.get(User, db.get(Agent, row.agent_id).user_id).name,
             "branch_id": row.branch_id, "category": row.category,
             "branch": db.get(Branch, row.branch_id).name,
             "quantity": row.quantity, "reason": row.reason, "urgency": row.urgency,
             "status": row.status, "fulfilled_asset_id": row.fulfilled_asset_id,
             "created_at": row.created_at} for row in rows]


@router.post("/requests", status_code=201)
def create_request(body: RequestCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    if role(db, user) not in {"Field Agent", "Team Leader", "Administrator", "Operations Manager"}:
        raise HTTPException(403, "Your role cannot request agent stock")
    assert_agent(db, user, body.agent_id)
    agent = db.get(Agent, body.agent_id)
    outlet = db.get(Outlet, agent.outlet_id)
    from .branch_lifecycle import active_branch
    active_branch(db, outlet.branch_id)
    row = FieldAssetRequest(agent_id=agent.id, branch_id=outlet.branch_id,
                            category=body.category, quantity=body.quantity,
                            reason=body.reason.strip(), urgency=body.urgency, status="REQUESTED")
    db.add(row)
    db.flush()
    audit(db, user, "Field Asset Requested", row.id, agent.id, new={"category": row.category, "quantity": row.quantity}, request=request)
    db.commit()
    return {"id": row.id, "status": row.status}


class RequestStatus(BusinessInput):
    status: Literal["APPROVED", "REJECTED", "FULFILLED"]
    reason: str = Field(min_length=5, max_length=300)
    asset_id: str = ""


@router.patch("/requests/{request_id}")
def update_request(request_id: str, body: RequestStatus, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    row = db.scalar(select(FieldAssetRequest).where(FieldAssetRequest.id == request_id).with_for_update())
    if not row:
        raise HTTPException(404, "Request not found")
    if body.status == "FULFILLED" and row.status != "APPROVED":
        raise HTTPException(409, "Approve the request before fulfilling it")
    if row.status in {"FULFILLED", "REJECTED"} or row.status == body.status:
        raise HTTPException(409, "Request cannot move to that status")
    if body.status == "FULFILLED":
        asset = db.scalar(select(FieldAsset).where(FieldAsset.id == body.asset_id.strip()).with_for_update())
        if not asset or asset.category != row.category or asset.agent_id != row.agent_id or asset.branch_id != row.branch_id or asset.quantity != row.quantity or asset.status != "ASSIGNED":
            raise HTTPException(422, "Assign matching stock to this agent before fulfilling the request")
        if db.scalar(select(FieldAssetRequest.id).where(FieldAssetRequest.fulfilled_asset_id == asset.id)):
            raise HTTPException(409, "This stock was already used to fulfill another request")
        row.fulfilled_asset_id = asset.id
    old = row.status
    row.status, row.actor_id = body.status, user.id
    audit(db, user, "Field Asset Request Updated", row.id, row.agent_id,
          old={"status": old}, new={"status": row.status}, reason=body.reason.strip(), request=request)
    db.commit()
    return {"id": row.id, "status": row.status}
