"""Parse SIM packs, claim activation work and notify administrators."""

import json
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, or_
from .db import Sim, SimProgress, Agent, User, Role, Notification, get_db
from .security import principal, require, assert_agent
from .services import audit

router = APIRouter(prefix="/api/inventory", tags=["SIM scanning"])


class Pack(BaseModel):
    code: str = Field(min_length=3, max_length=2000)


def parse_pack(code):
    code = code.strip()
    fields = {}
    aliases = {
        "iccid": "iccid",
        "simserial": "serial",
        "serial": "serial",
        "serialnumber": "serial",
        "simtype": "sim_type",
        "type": "sim_type",
    }
    try:
        values = json.loads(code)
        if isinstance(values, dict):
            for key, value in values.items():
                name = aliases.get(re.sub(r"[^a-z]", "", key.lower()))
                if name and isinstance(value, (str, int)):
                    fields[name] = str(value).strip()
    except (ValueError, TypeError):
        pass
    for match in re.finditer(
        r"(?i)(ICCID|SIM\s*Serial|Serial(?:\s*Number)?|SIM\s*Type)\s*[:=]\s*([^;|&\n]+)", code
    ):
        name = aliases.get(re.sub(r"[^a-z]", "", match[1].lower()))
        fields[name] = match[2].strip()
    if not fields and (
        re.fullmatch(r"89\d{17,18}", code)
        or re.fullmatch(r"(?:SAMPLE-SIM|SIM-SAMPLE)[-A-Z0-9]+", code)
    ):
        fields["iccid"] = code
    if not fields.get("iccid") or len(fields["iccid"]) > 60 or len(fields.get("serial", "")) > 60:
        raise HTTPException(
            422, "No ICCID found. Scan the SIM pack barcode or QR code containing its ICCID."
        )
    fields["serial"] = fields.get("serial") or fields["iccid"]
    fields["sim_type"] = (
        "eSIM" if fields.get("sim_type", "").upper() in {"ESIM", "E-SIM", "DIGITAL"} else "Physical"
    )
    return fields


@router.post("/parse-pack")
def parse(body: Pack, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "inventory.write")
    return parse_pack(body.code)


class Scan(Pack):
    transaction_id: str = Field(min_length=16, max_length=80)
    agent_id: str = ""


def claim(db, user, identifier, transaction_id, agent_id, request=None):
    assert_agent(db, user, agent_id)
    from .db import Outlet
    from .branch_lifecycle import active_branch
    active_branch(db, db.get(Outlet, db.get(Agent, agent_id).outlet_id).branch_id)
    sim = db.scalar(
        select(Sim).where(or_(Sim.iccid == identifier, Sim.serial == identifier)).with_for_update()
    )
    if sim is None:
        raise HTTPException(
            422, "This SIM is not in inventory. Ask an administrator to add and assign it."
        )
    if sim.agent_id != agent_id or sim.status not in {"AVAILABLE", "ASSIGNED TO AGENT", "RESERVED"}:
        raise HTTPException(409, "This SIM is unavailable or assigned to another agent.")
    progress = db.scalar(select(SimProgress).where(SimProgress.sim_id == sim.id).with_for_update())
    if progress and (progress.transaction_id != transaction_id or progress.agent_id != agent_id):
        raise HTTPException(
            409, "This SIM is already in another transaction. Resume or discard that draft first."
        )
    for previous in db.scalars(select(SimProgress).where(SimProgress.transaction_id == transaction_id, SimProgress.sim_id != sim.id).with_for_update()):
        assert_agent(db, user, previous.agent_id)
        if previous.capture_id:
            raise HTTPException(409, "This transaction was already submitted. Its SIM cannot be replaced.")
        audit(db,user,"SIM scan replaced",previous.sim_id,previous.agent_id,request=request)
        db.delete(previous)
    if progress is None:
        progress = SimProgress(
            sim_id=sim.id,
            agent_id=agent_id,
            transaction_id=transaction_id,
            stage="IN_PROGRESS",
            payment_status="NOT_UPLOADED",
        )
        db.add(progress)
        agent = db.get(Agent, agent_id)
        name = db.get(User, agent.user_id).name
        for administrator in db.scalars(
            select(User).join(Role, User.role_id == Role.id).where(Role.name == "Administrator")
        ):
            db.add(
                Notification(
                    user_id=administrator.id,
                    message=f"{name} started a SIM transaction · {sim.iccid}"[:250],
                )
            )
        audit(
            db,
            user,
            "SIM scan started",
            sim.id,
            agent_id,
            new={"stage": "IN_PROGRESS", "payment_status": "NOT_UPLOADED"},
            request=request,
        )
    return sim, progress


@router.post("/scan")
def scan(body: Scan, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "ekyc.write")
    agent = db.scalar(select(Agent).where(Agent.user_id == user.id))
    agent_id = body.agent_id or (agent.id if agent else "")
    try:
        identifier = parse_pack(body.code)["iccid"]
    except HTTPException:
        identifier = body.code.strip()
        if not re.fullmatch(r"[A-Za-z0-9-]{3,60}", identifier):
            raise HTTPException(422, "No valid SIM barcode found")
    if not agent_id:
        assigned = db.scalar(
            select(Sim).where(or_(Sim.iccid == identifier, Sim.serial == identifier))
        )
        agent_id = assigned.agent_id if assigned else ""
    if not agent_id:
        raise HTTPException(422, "Assign this SIM to an agent first")
    sim, progress = claim(db, user, identifier, body.transaction_id, agent_id, request)
    db.commit()
    return {
        "agent_id": agent_id,
        "sim_identifier": sim.iccid,
        "sim_type": "ESIM" if sim.sim_type == "eSIM" else "PHYSICAL",
        "stage": progress.stage,
        "payment_status": progress.payment_status,
    }


@router.delete("/scan/{transaction_id}")
def abandon(transaction_id: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "ekyc.write")
    rows = list(
        db.scalars(
            select(SimProgress)
            .where(SimProgress.transaction_id == transaction_id)
            .with_for_update()
        )
    )
    for row in rows:
        assert_agent(db, user, row.agent_id)
        if row.capture_id:
            raise HTTPException(
                409, "Submitted transactions must be handled by the backend review team."
            )
        audit(db, user, "SIM scan discarded", row.sim_id, row.agent_id, request=request)
        db.delete(row)
    db.commit()
    return {"discarded": True}


@router.get("/scan-notifications")
def scan_notifications(user=Depends(principal), db=Depends(get_db)):
    require(db, user, "inventory.write")
    notifications = list(
        db.scalars(
            select(Notification)
            .where(
                Notification.user_id == user.id, Notification.message.contains("SIM transaction")
            )
            .order_by(Notification.created_at.desc())
            .limit(30)
        )
    )
    iccids = {n.message.rsplit(" · ", 1)[-1] for n in notifications}
    sim_ids = {
        sim.iccid: sim.id
        for sim in db.scalars(select(Sim).where(Sim.iccid.in_(iccids)))
    }
    return [
        {
            "id": n.id,
            "message": n.message,
            "created_at": n.created_at,
            "sim_id": sim_ids.get(n.message.rsplit(" · ", 1)[-1]),
        }
        for n in notifications
    ]
