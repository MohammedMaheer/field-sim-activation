"""Add today's clearly identified synthetic sales without rewriting existing history.

Explicit opt-in only: RELAY_DEMO_REFRESH=1 python -m app.demo_refresh.
"""

import os
from datetime import timedelta
from sqlalchemy import select
from .db import (
    DB,
    Agent,
    User,
    Order,
    Activation,
    OrderEvent,
    Sim,
    Movement,
    Audit,
    FieldTask,
    SupportTicket,
    business_date,
    now,
)


def refresh_demo():
    if os.getenv("RELAY_DEMO_REFRESH") != "1":
        raise RuntimeError("Demo refresh requires explicit RELAY_DEMO_REFRESH=1")
    count = 0
    with DB() as db:
        admin = db.scalar(select(User).where(User.email == "admin@relay.demo"))
        if not admin:
            raise RuntimeError("Synthetic demo administrator not found")
        day = business_date().isoformat()
        for index, agent in enumerate(db.scalars(select(Agent).order_by(Agent.employee_id)).all()):
            template = db.scalar(
                select(Order).where(Order.agent_id == agent.id, Order.operation_id.like("seed-%"))
            )
            if not template:
                continue
            for slot in range(5 + index % 7):
                key = f"demo-day-{day}-{agent.employee_id}-{slot}"
                if db.scalar(select(Order.id).where(Order.operation_id == key)):
                    continue
                stamp = now() - timedelta(minutes=slot * 7)
                state = (
                    "PROCESSING"
                    if slot == 0 and index % 3 == 0
                    else "FAILED"
                    if slot == 1 and index % 5 == 0
                    else "ACTIVATED"
                )
                sim = Sim(
                    iccid=key,
                    serial=key,
                    sim_type="eSIM" if slot % 3 == 0 else "Physical",
                    status="RESERVED"
                    if state == "PROCESSING"
                    else "BLOCKED"
                    if state == "FAILED"
                    else "ACTIVATED",
                    agent_id=agent.id,
                    outlet_id=agent.outlet_id,
                    assigned_at=stamp,
                    activated_at=stamp if state == "ACTIVATED" else None,
                )
                db.add(sim)
                db.flush()
                ref = f"DEMO-{day.replace('-', '')}-{index:02}-{slot:02}"
                order = Order(
                    reference=ref,
                    request_id="REQ-" + ref,
                    sr_id="SR-" + ref,
                    msisdn=template.msisdn,
                    agent_id=agent.id,
                    customer_id=template.customer_id,
                    plan_id=template.plan_id,
                    sim_id=sim.id,
                    status=state,
                    operation_id=key,
                    handling_seconds=180 + slot * 14,
                    draft={"synthetic": True},
                    created_at=stamp,
                    updated_at=stamp,
                )
                db.add(order)
                db.flush()
                db.add(
                    OrderEvent(
                        order_id=order.id,
                        actor="Demo data service",
                        action="Synthetic sales record imported",
                        created_at=stamp,
                    )
                )
                if state == "ACTIVATED":
                    db.add(
                        Activation(
                            order_id=order.id,
                            provider_reference="DEMO-" + order.id,
                            status=state,
                            created_at=stamp,
                        )
                    )
                db.add(
                    Movement(
                        sim_id=sim.id,
                        agent_id=agent.id,
                        user_id=admin.id,
                        old_status="WAREHOUSE",
                        new_status=sim.status,
                        reason="Explicit synthetic demo refresh",
                        created_at=stamp,
                    )
                )
                db.add(
                    Audit(
                        user_id=admin.id,
                        actor="Demo data service",
                        role="Administrator",
                        action="Synthetic sales record added",
                        entity=order.id,
                        agent_id=agent.id,
                        new_value={"status": state, "synthetic": True},
                        created_at=stamp,
                    )
                )
                count += 1
            title = "Review branch transactions · " + day
            if not db.scalar(
                select(FieldTask.id).where(FieldTask.agent_id == agent.id, FieldTask.title == title)
            ):
                db.add(
                    FieldTask(
                        agent_id=agent.id,
                        title=title,
                        note="Check captured rows before submitting to the backend team.",
                        due_date=day,
                    )
                )
            subject = "Screenshot clarity guidance · " + day
            if not db.scalar(
                select(SupportTicket.id).where(
                    SupportTicket.agent_id == agent.id, SupportTicket.subject == subject
                )
            ):
                db.add(
                    SupportTicket(
                        agent_id=agent.id,
                        subject=subject,
                        message="Please confirm the best format for a completed transaction screenshot.",
                        status="RESOLVED",
                        response="Use the original PNG or JPEG. Keep the full transaction visible and review extracted rows before submitting.",
                    )
                )
        db.commit()
    print(f"Added {count} synthetic daily sales records; existing records preserved.")


if __name__ == "__main__":
    refresh_demo()
