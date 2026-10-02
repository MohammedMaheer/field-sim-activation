"""Audited branch departures preserve historical sales and stock records."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select, or_
from .db import Agent, Branch, FieldAssetRequest, KycCapture, Outlet, SalesRecord, get_db
from .organization import administrator
from .security import principal
from .services import audit
from .validation import BusinessInput

router = APIRouter(prefix="/api/branch-lifecycle", tags=["Branch lifecycle"])


def active_branch(db, branch_id):
    branch = db.scalar(select(Branch).where(Branch.id == branch_id).with_for_update())
    if not branch:
        raise HTTPException(422, "Select a valid branch")
    if branch.lifecycle_status != "ACTIVE":
        raise HTTPException(409, "This branch is closing or relocated. Choose an active branch.")
    return branch


def state(db, user, branch):
    from .field_assets import return_checklist
    stock = return_checklist(branch_id=branch.id, user=user, db=db)
    outlets = select(Outlet.id).where(Outlet.branch_id == branch.id)
    agents = db.scalars(select(Agent).where(Agent.outlet_id.in_(outlets), Agent.employment_status == "ACTIVE")).all()
    # Historical branch snapshots, rather than current agent assignments, own these sales.
    sales = db.scalars(select(SalesRecord).where(SalesRecord.branch_id == branch.id, SalesRecord.status.not_in(["CLOSED", "REJECTED", "CANCELLED"]))).all()
    captures = db.scalars(select(KycCapture).where(or_(KycCapture.branch_id == branch.id, KycCapture.branch_id.is_(None) & KycCapture.agent_id.in_(select(Agent.id).where(Agent.outlet_id.in_(outlets)))), KycCapture.status.not_in(["VERIFIED", "REJECTED"]))).all()
    requests = db.scalars(select(FieldAssetRequest).where(FieldAssetRequest.branch_id == branch.id, FieldAssetRequest.status.in_(["REQUESTED", "APPROVED"]))).all()
    return {"id": branch.id, "name": branch.name, "status": branch.lifecycle_status,
            "destination_branch_id": branch.relocation_branch_id, "stock": stock["outstanding"],
            "active_agents": [{"id": a.id, "name": a.employee_id} for a in agents],
            "pending_sales": len(sales), "pending_evidence": len(captures), "open_requests": len(requests),
            "ready": not(stock["outstanding"] or agents or sales or captures or requests)}


@router.get("/{branch_id}")
def checklist(branch_id: str, user=Depends(principal), db=Depends(get_db)):
    from .field_assets import visible_branches
    if branch_id not in visible_branches(db, user):
        raise HTTPException(404, "Branch not found")
    return state(db, user, db.get(Branch, branch_id))


class Change(BusinessInput):
    action: Literal["START_CLOSURE", "START_RELOCATION", "CANCEL", "COMPLETE"]
    destination_branch_id: str = ""
    reason: str = Field(min_length=5, max_length=300)


@router.post("/{branch_id}")
def change(branch_id: str, body: Change, request: Request, user=Depends(principal), db=Depends(get_db)):
    administrator(db, user)
    branch = db.scalar(select(Branch).where(Branch.id == branch_id).with_for_update())
    if not branch:
        raise HTTPException(404, "Branch not found")
    old = {"status": branch.lifecycle_status, "destination": branch.relocation_branch_id}
    if body.action.startswith("START_"):
        if branch.lifecycle_status != "ACTIVE":
            raise HTTPException(409, "A branch operation is already in progress or completed")
        if body.action == "START_RELOCATION":
            if body.destination_branch_id == branch.id:
                raise HTTPException(422, "Choose a different destination branch")
            active_branch(db, body.destination_branch_id)
            branch.relocation_branch_id = body.destination_branch_id
            branch.lifecycle_status = "RELOCATING"
        else:
            branch.lifecycle_status = "CLOSING"
    elif branch.lifecycle_status not in {"CLOSING", "RELOCATING"}:
        raise HTTPException(409, "Start a branch operation first")
    elif body.action == "CANCEL":
        branch.lifecycle_status, branch.relocation_branch_id = "ACTIVE", None
    else:
        if not state(db, user, branch)["ready"]:
            raise HTTPException(409, "Account for stock, transfer or exit agents, and resolve pending sales, evidence and requests first")
        if branch.relocation_branch_id:
            active_branch(db, branch.relocation_branch_id)
        branch.lifecycle_status = "RELOCATED" if branch.relocation_branch_id else "CLOSED"
    audit(db, user, "Branch Lifecycle Updated", branch.id, old=old,
          new={"status": branch.lifecycle_status, "destination": branch.relocation_branch_id}, reason=body.reason, request=request)
    db.commit()
    return state(db, user, branch)
