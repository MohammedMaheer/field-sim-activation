"""Idempotent synthetic records for client evaluation; never alters accounts or plans."""

import os
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .db import (Agent, CallAttempt, DB, FieldAsset, FieldAssetMovement, FieldAssetRequest, SalesCallTask,
                 NoSaleFeedback, Outlet, Plan, Role, SalesRecord, SalesTarget, User)


def seed():
    if os.getenv("RELAY_SEED_SALES") != "YES":
        raise SystemExit("Set RELAY_SEED_SALES=YES to add synthetic sales records")
    period = datetime.now(ZoneInfo("Asia/Dubai")).strftime("%Y-%m")
    with DB() as db:
        agents = db.scalars(select(Agent).order_by(Agent.employee_id).limit(3)).all()
        plans = db.scalars(select(Plan).where(Plan.active.is_(True)).order_by(Plan.name).limit(3)).all()
        admin = db.scalar(select(User).join(Role).where(Role.name == "Administrator"))
        if len(agents) < 2 or not plans or not admin:
            raise SystemExit("Create agents and at least one active plan before seeding sales")
        names = ["Jordan Vale", "Avery Quinn", "Leila Arden"]
        for index, agent in enumerate(agents):
            reference = f"SAMPLE-SALES-{index + 1:03d}"
            if db.scalar(select(SalesRecord.id).where(SalesRecord.request_id == reference)):
                continue
            outlet = db.get(Outlet, agent.outlet_id)
            db.add(SalesRecord(agent_id=agent.id, leader_id=agent.leader_id,
                branch_id=outlet.branch_id, outlet_id=outlet.id,
                order_type=("NEW", "MNP", "HW")[index], customer_name=names[index],
                document_encrypted="", nationality="", plan_name=plans[index % len(plans)].name,
                request_id=reference, status=("CLOSED", "IN_PROGRESS", "IN_PROGRESS")[index],
                details={"account_number": f"SAMPLE-ACCOUNT-{index + 1:03d}",
                         "msisdn": f"SAMPLE-PHONE-{index + 1:03d}",
                         "router_serial": "SAMPLE-ROUTER-003" if index == 2 else ""}))
        db.flush()
        first_sale = db.scalar(select(SalesRecord).where(SalesRecord.request_id == "SAMPLE-SALES-001"))
        if first_sale and not db.scalar(select(CallAttempt.id).where(CallAttempt.sale_id == first_sale.id)):
            db.add(CallAttempt(sale_id=first_sale.id, stage="TELE_VERIFICATION",
                outcome="PASSED", remark="Details confirmed", actor_id=admin.id))
            db.add(CallAttempt(sale_id=first_sale.id, stage="WELCOME_CALL",
                outcome="REACHED", remark="Customer welcomed", actor_id=admin.id))
        for sale in db.scalars(select(SalesRecord).where(SalesRecord.request_id.like("SAMPLE-SALES-%"))):
            for stage, status in (("TELE_VERIFICATION", "COMPLETED" if sale.id == first_sale.id else "PENDING"),
                                  ("WELCOME_CALL", "COMPLETED" if sale.id == first_sale.id else "BLOCKED")):
                if not db.scalar(select(SalesCallTask.id).where(SalesCallTask.sale_id == sale.id, SalesCallTask.stage == stage)):
                    db.add(SalesCallTask(sale_id=sale.id, stage=stage, status=status))
        first = agents[0]
        outlet = db.get(Outlet, first.outlet_id)
        if not db.scalar(select(NoSaleFeedback.id).where(NoSaleFeedback.agent_id == first.id,
                 NoSaleFeedback.product_suggested == "Sample consultation")):
            db.add(NoSaleFeedback(agent_id=first.id, leader_id=first.leader_id,
                branch_id=outlet.branch_id, customer_name="Casey Morgan", contact_encrypted="",
                product_suggested="Sample consultation", feedback="Asked to review options later",
                rejection_reason="Follow-up requested"))
        for agent in agents:
            if not db.scalar(select(SalesTarget.id).where(SalesTarget.agent_id == agent.id,
                   SalesTarget.period == period, SalesTarget.order_type == "ALL")):
                db.add(SalesTarget(agent_id=agent.id, period=period, order_type="ALL",
                    daily_target=2, monthly_target=20, set_by=admin.id))
        if not db.scalar(select(FieldAsset.id).where(FieldAsset.serial == "SAMPLE-DEVICE-001")):
            db.add(FieldAsset(category="GRABBA_DEVICE", label="Handheld verification reader",
                serial="SAMPLE-DEVICE-001", quantity=1, status="ASSIGNED",
                branch_id=outlet.branch_id, agent_id=first.id, note=""))
        if not db.scalar(select(FieldAsset.id).where(FieldAsset.serial == "SAMPLE-ROUTER-001")):
            db.add(FieldAsset(category="ROUTER", label="Home wireless router",
                serial="SAMPLE-ROUTER-001", quantity=1, status="AVAILABLE",
                branch_id=outlet.branch_id, note=""))
        db.flush()
        device = db.scalar(select(FieldAsset).where(FieldAsset.serial == "SAMPLE-DEVICE-001"))
        if not db.scalar(select(FieldAssetMovement.id).where(FieldAssetMovement.asset_id == device.id)):
            db.add(FieldAssetMovement(asset_id=device.id, from_branch_id=outlet.branch_id,
                to_branch_id=outlet.branch_id, from_agent_id=None, to_agent_id=first.id,
                actor_id=admin.id, reason="Issued to agent"))
        if not db.scalar(select(FieldAssetRequest.id).where(FieldAssetRequest.agent_id == first.id,
                 FieldAssetRequest.category == "UNIFORM")):
            db.add(FieldAssetRequest(agent_id=first.id, branch_id=outlet.branch_id,
                category="UNIFORM", quantity=1, reason="Replacement requested", status="REQUESTED"))
        db.commit()


if __name__ == "__main__":
    seed()
