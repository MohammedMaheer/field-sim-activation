"""Branch equipment and supplies, separate from serialised SIM inventory."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .db import Agent, Branch, FieldAsset, FieldAssetMovement, FieldAssetRequest, Outlet, Role, User, get_db
from .security import assert_agent, principal, visible_agents
from .services import audit

router = APIRouter(prefix="/api/field-assets", tags=["Field assets"])
Category = Literal["GRABBA_DEVICE", "ROUTER", "STAMP", "ID_CARD", "UNIFORM", "OTHER"]
Status = Literal["AVAILABLE", "ASSIGNED", "RETURNED", "DAMAGED", "RETIRED"]
MANAGERS = {"Administrator", "Operations Manager", "Inventory Manager"}


def role(db, user):
    return db.get(Role, user.role_id).name


def may_manage(db, user):
    if role(db, user) not in MANAGERS:
        raise HTTPException(403, "Only stock managers can change field assets")


def asset_scope(db, user):
    query = select(FieldAsset)
    name = role(db, user)
    if name == "Field Agent":
        query = query.where(FieldAsset.agent_id.in_(visible_agents(db, user)))
    elif name == "Team Leader":
        query = query.where(FieldAsset.agent_id.in_(visible_agents(db, user)))
    elif name == "Branch Manager":
        query = query.where(FieldAsset.branch_id == user.branch_id)
    return query


def request_scope(db, user):
    query = select(FieldAssetRequest)
    name = role(db, user)
    if name in {"Field Agent", "Team Leader"}:
        query = query.where(FieldAssetRequest.agent_id.in_(visible_agents(db, user)))
    elif name == "Branch Manager":
        query = query.where(FieldAssetRequest.branch_id == user.branch_id)
    return query


def view(db, row):
    agent = db.get(Agent, row.agent_id) if row.agent_id else None
    return {"id": row.id, "category": row.category, "label": row.label,
            "serial": row.serial or "Not recorded", "quantity": row.quantity,
            "status": row.status, "branch_id": row.branch_id,
            "branch": db.get(Branch, row.branch_id).name,
            "agent_id": row.agent_id, "agent": db.get(User, agent.user_id).name if agent else "Unassigned",
            "note": row.note, "created_at": row.created_at}


@router.get("")
def assets(user=Depends(principal), db=Depends(get_db)):
    rows = db.scalars(asset_scope(db, user).order_by(FieldAsset.created_at.desc()).limit(1000)).all()
    return [view(db, row) for row in rows]


class AssetCreate(BaseModel):
    category: Category
    label: str = Field(min_length=2, max_length=160)
    serial: str = Field(default="", max_length=120)
    quantity: int = Field(ge=1, le=10000)
    branch_id: str
    note: str = Field(default="", max_length=500)


@router.post("", status_code=201)
def create_asset(body: AssetCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    if not db.get(Branch, body.branch_id):
        raise HTTPException(404, "Branch not found")
    serial = body.serial.strip() or None
    if serial and body.quantity != 1:
        raise HTTPException(422, "A serialised item must have quantity one")
    if serial and db.scalar(select(FieldAsset.id).where(FieldAsset.serial == serial)):
        raise HTTPException(409, "Serial already recorded")
    row = FieldAsset(category=body.category, label=body.label.strip(), serial=serial,
                     quantity=body.quantity, branch_id=body.branch_id, status="AVAILABLE", note=body.note.strip())
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Serial already recorded") from None
    audit(db, user, "Field Asset Added", row.id, new={"category": row.category, "branch_id": row.branch_id}, request=request)
    db.commit()
    return view(db, row)


class AssetChange(BaseModel):
    branch_id: str
    agent_id: str = ""
    status: Status
    reason: str = Field(min_length=5, max_length=300)


@router.patch("/{asset_id}")
def move_asset(asset_id: str, body: AssetChange, request: Request, user=Depends(principal), db=Depends(get_db)):
    may_manage(db, user)
    row = db.scalar(select(FieldAsset).where(FieldAsset.id == asset_id).with_for_update())
    if not row:
        raise HTTPException(404, "Asset not found")
    if not db.get(Branch, body.branch_id):
        raise HTTPException(404, "Branch not found")
    agent_id = body.agent_id.strip() or None
    if agent_id:
        agent = db.get(Agent, agent_id)
        outlet = db.get(Outlet, agent.outlet_id) if agent else None
        if not outlet or outlet.branch_id != body.branch_id:
            raise HTTPException(422, "Agent must belong to the selected branch")
    if body.status == "ASSIGNED" and not agent_id:
        raise HTTPException(422, "Assign an agent for this status")
    if body.status in {"AVAILABLE", "RETURNED", "RETIRED"} and agent_id:
        raise HTTPException(422, "This status cannot have an assigned agent")
    old = {"branch_id": row.branch_id, "agent_id": row.agent_id, "status": row.status}
    if old == {"branch_id": body.branch_id, "agent_id": agent_id, "status": body.status}:
        raise HTTPException(409, "No asset change to record")
    db.add(FieldAssetMovement(asset_id=row.id, from_branch_id=row.branch_id,
        to_branch_id=body.branch_id, from_agent_id=row.agent_id, to_agent_id=agent_id,
        actor_id=user.id, reason=body.reason.strip()))
    row.branch_id, row.agent_id, row.status = body.branch_id, agent_id, body.status
    audit(db, user, "Field Asset Moved", row.id, old=old,
          new={"branch_id": row.branch_id, "agent_id": row.agent_id, "status": row.status},
          reason=body.reason.strip(), request=request)
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
             "reason": move.reason} for move in moves]


class RequestCreate(BaseModel):
    agent_id: str
    category: Category
    quantity: int = Field(ge=1, le=10000)
    reason: str = Field(min_length=5, max_length=300)


@router.get("/requests/list")
def requests(user=Depends(principal), db=Depends(get_db)):
    rows = db.scalars(request_scope(db, user).order_by(FieldAssetRequest.created_at.desc()).limit(1000)).all()
    return [{"id": row.id, "agent_id": row.agent_id,
             "agent": db.get(User, db.get(Agent, row.agent_id).user_id).name,
             "branch_id": row.branch_id, "category": row.category,
             "quantity": row.quantity, "reason": row.reason,
             "status": row.status, "fulfilled_asset_id": row.fulfilled_asset_id,
             "created_at": row.created_at} for row in rows]


@router.post("/requests", status_code=201)
def create_request(body: RequestCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    assert_agent(db, user, body.agent_id)
    agent = db.get(Agent, body.agent_id)
    outlet = db.get(Outlet, agent.outlet_id)
    row = FieldAssetRequest(agent_id=agent.id, branch_id=outlet.branch_id,
                            category=body.category, quantity=body.quantity,
                            reason=body.reason.strip(), status="REQUESTED")
    db.add(row)
    db.flush()
    audit(db, user, "Field Asset Requested", row.id, agent.id, new={"category": row.category, "quantity": row.quantity}, request=request)
    db.commit()
    return {"id": row.id, "status": row.status}


class RequestStatus(BaseModel):
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
        asset = db.get(FieldAsset, body.asset_id.strip())
        if not asset or asset.category != row.category or asset.agent_id != row.agent_id or asset.branch_id != row.branch_id or asset.quantity < row.quantity or asset.status != "ASSIGNED":
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
