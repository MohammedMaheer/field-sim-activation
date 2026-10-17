import math
from collections import defaultdict
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import func, select, update
from .db import *
from .security import assert_agent, require
from . import providers


def audit(db, user, action, entity, agent_id=None, old=None, new=None, reason="", request=None):
    db.add(
        Audit(
            user_id=user.id,
            actor=user.name,
            role=db.get(Role, user.role_id).name,
            action=action,
            entity=entity,
            agent_id=agent_id,
            old_value=old or {},
            new_value=new or {},
            reason=reason,
            device=(request.headers.get("x-device-id", "Web")[:100] if request else "System"),
            ip=(request.client.host if request and request.client else ""),
        )
    )
    db.add(Event(agent_id=agent_id, kind=action, entity_id=entity))


def distance_m(lat, lng, lat2, lng2):
    a, b = math.radians(lat), math.radians(lat2)
    h = (
        math.sin((b - a) / 2) ** 2
        + math.cos(a) * math.cos(b) * math.sin(math.radians(lng2 - lng) / 2) ** 2
    )
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def polygon_contains(lat, lng, polygon):
    inside = False
    j = len(polygon) - 1
    for i, (x, y) in enumerate(polygon):
        xj, yj = polygon[j]
        if (y > lat) != (yj > lat) and lng < (xj - x) * (lat - y) / (yj - y) + x:
            inside = not inside
        j = i
    return inside


def classify_location(distance, radius, accuracy, tolerance):
    if accuracy > 100:
        return "LOW ACCURACY"
    margin = max(accuracy, tolerance)
    if distance > radius + margin:
        return "OUT OF BOUNDS"
    if distance >= radius - margin:
        return "NEAR BOUNDARY"
    return "IN BOUNDS"


TRANSITIONS = {
    "DRAFT": {"SUBMITTED", "CANCELLED"},
    "SUBMITTED": {"PROCESSING", "REJECTED"},
    "PROCESSING": {"ACTIVATED", "FAILED"},
    "ACTIVATED": set(),
    "FAILED": set(),
    "REJECTED": set(),
    "CANCELLED": set(),
}


def transition(db, order, state, actor):
    if state not in TRANSITIONS.get(order.status, set()):
        raise HTTPException(409, f"Cannot move {order.status} to {state}")
    order.status = state
    order.updated_at = now()
    db.add(OrderEvent(order_id=order.id, actor=actor, action=state.replace("_", " ").title()))


def submit(db, user, order_id, request=None, permission="activation.write", monitor_location=True):
    require(db, user, permission)
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not order:
        raise HTTPException(404, "Order not found")
    assert_agent(db, user, order.agent_id)
    if order.status in {"PROCESSING", "ACTIVATED", "SUBMITTED"}:
        return order
    if order.status != "DRAFT":
        raise HTTPException(409, "Only drafts can be submitted")
    ekyc = db.get(Ekyc, order.ekyc_id) if order.ekyc_id else None
    plan = db.get(Plan, order.plan_id) if order.plan_id else None
    sim = db.get(Sim, order.sim_id) if order.sim_id else None
    if (
        not ekyc
        or ekyc.status != "VERIFIED"
        or ekyc.agent_id != order.agent_id
        or ekyc.customer_id != order.customer_id
    ):
        raise HTTPException(422, "Verified customer identity is required")
    document = db.scalar(select(Document).where(Document.customer_id == order.customer_id))
    if not document or document.expiry < business_date().isoformat():
        raise HTTPException(422, "Identity document has expired")
    if not plan or not plan.active:
        raise HTTPException(422, "Select an active plan")
    if not sim or sim.agent_id != order.agent_id:
        raise HTTPException(422, "Select a SIM assigned to this agent")
    changed = db.execute(
        update(Sim).where(Sim.id == sim.id, Sim.status == "AVAILABLE").values(status="RESERVED")
    ).rowcount
    if changed != 1:
        raise HTTPException(409, "SIM is no longer available. Select another SIM.")
    db.add(
        Movement(
            sim_id=sim.id,
            agent_id=sim.agent_id,
            user_id=user.id,
            old_status="AVAILABLE",
            new_status="RESERVED",
            reason="Activation allocation",
        )
    )
    audit(
        db,
        user,
        "SIM Reserved",
        sim.id,
        order.agent_id,
        {"status": "AVAILABLE"},
        {"status": "RESERVED"},
        request=request,
    )
    db.add(OrderEvent(order_id=order.id, actor=user.name, action="eKYC verified"))
    db.add(OrderEvent(order_id=order.id, actor=user.name, action="SIM assigned"))
    transition(db, order, "SUBMITTED", user.name)
    receipt = providers.payment.authorize(order.id, plan.advance)
    order.draft = {**order.draft, "payment": receipt}
    transition(db, order, "PROCESSING", "Mock telecom gateway")
    order.handling_seconds = max(1, int((now() - order.created_at).total_seconds()))
    audit(
        db,
        user,
        "Activation Submitted",
        order.id,
        order.agent_id,
        {"status": "DRAFT"},
        {"status": "PROCESSING"},
        request=request,
    )
    agent = db.get(Agent, order.agent_id)
    if monitor_location and agent.geofence == "OUT OF BOUNDS":
        db.add(
            Alert(
                agent_id=agent.id, title="Activation submitted outside territory", severity="REVIEW"
            )
        )
    db.commit()
    return order


def finish_pending():
    with DB() as db:
        orders = db.scalars(
            select(Order)
            .where(Order.status == "PROCESSING", Order.updated_at < now() - timedelta(seconds=8))
            .with_for_update(skip_locked=True)
        ).all()
        for order in orders:
            result = providers.telecom.activate(order.id)
            transition(db, order, result["status"], "Mock telecom gateway")
            sim = db.get(Sim, order.sim_id)
            agent = db.get(Agent, order.agent_id)
            user = db.get(User, agent.user_id)
            if sim:
                old = sim.status
                sim.status = "ACTIVATED" if result["status"] == "ACTIVATED" else "AVAILABLE"
                sim.activated_at = now() if sim.status == "ACTIVATED" else None
                db.add(
                    Movement(
                        sim_id=sim.id,
                        agent_id=agent.id,
                        user_id=user.id,
                        old_status=old,
                        new_status=sim.status,
                        reason="Provider result",
                    )
                )
                audit(
                    db,
                    user,
                    "SIM Status Updated",
                    sim.id,
                    agent.id,
                    {"status": old},
                    {"status": sim.status},
                )
            db.add(
                Activation(
                    order_id=order.id,
                    provider_reference=result["reference"],
                    status=result["status"],
                )
            )
            audit(
                db,
                user,
                "Activation Completed",
                order.id,
                agent.id,
                {"status": "PROCESSING"},
                {"status": order.status},
            )
        db.commit()


def raw(row):
    return {
        c.name: (
            getattr(row, c.name).isoformat() + "Z"
            if isinstance(getattr(row, c.name), __import__("datetime").datetime)
            else getattr(row, c.name)
        )
        for c in row.__table__.columns
    }


def order_views(db, rows):
    """Preload only related records in this authorized order set (bounded query count)."""
    agents = list(db.scalars(select(Agent).where(Agent.id.in_({r.agent_id for r in rows}))))
    # Keep strong references for SQLAlchemy's identity map through serialization.
    related = [
        list(db.scalars(select(User).where(User.id.in_({a.user_id for a in agents})))),
        list(db.scalars(select(Outlet).where(Outlet.id.in_({a.outlet_id for a in agents})))),
        list(
            db.scalars(
                select(Customer).where(
                    Customer.id.in_({r.customer_id for r in rows if r.customer_id})
                )
            )
        ),
        list(db.scalars(select(Plan).where(Plan.id.in_({r.plan_id for r in rows if r.plan_id})))),
    ]
    result = [order_view(db, row) for row in rows]
    del related
    return result


def order_view(db, row):
    agent = db.get(Agent, row.agent_id)
    customer = db.get(Customer, row.customer_id) if row.customer_id else None
    plan = db.get(Plan, row.plan_id) if row.plan_id else None
    return {
        **raw(row),
        "draft": {k: v for k, v in row.draft.items() if k != "transaction_data"},
        "agent": db.get(User, agent.user_id).name,
        "outlet": db.get(Outlet, agent.outlet_id).name,
        "customer": customer.name if customer else row.draft.get("name", "New customer"),
        "plan": plan.name if plan else "Not selected",
    }


def retain_references(db, model, ids):
    """Keep small related rows in this request's identity map, never in a global cache."""
    stored = db.info.setdefault("workspace_read_references", {}).setdefault(model, {})
    missing = set(ids) - {None, ""} - stored.keys()
    if missing:
        stored.update((row.id, row) for row in db.scalars(select(model).where(model.id.in_(missing))))
    return stored


def retain_agent_references(db, agents):
    retained = db.info.setdefault("workspace_read_references", {}).setdefault(Agent, {})
    retained.update((agent.id, agent) for agent in agents)
    outlets = retain_references(db, Outlet, {agent.outlet_id for agent in agents})
    retain_references(db, Branch, {outlets[agent.outlet_id].branch_id for agent in agents})
    retain_references(db, User, {value for agent in agents for value in (agent.user_id, agent.leader_id)})


def agent_views(db, agents):
    """Serialize an authorized agent list with a bounded set of related queries."""
    if not agents:
        return []
    retain_agent_references(db, agents)
    ids = {agent.id for agent in agents}
    orders, checks = defaultdict(list), defaultdict(list)
    for row in db.scalars(select(Order).where(Order.agent_id.in_(ids))):
        orders[row.agent_id].append(row)
    for row in db.scalars(select(Ekyc).where(Ekyc.agent_id.in_(ids))):
        checks[row.agent_id].append(row)
    stock = dict(db.execute(select(Sim.agent_id, func.count()).where(Sim.agent_id.in_(ids), Sim.status == "AVAILABLE").group_by(Sim.agent_id)).all())
    shifts = set(db.scalars(select(Shift.agent_id).where(Shift.agent_id.in_(ids), Shift.ended_at.is_(None))))
    context = {"orders": orders, "checks": checks, "stock": stock, "shifts": shifts}
    return [agent_view(db, agent, context) for agent in agents]


def agent_view(db, agent, context=None):
    orders = context["orders"][agent.id] if context is not None else db.scalars(select(Order).where(Order.agent_id == agent.id)).all()
    today = [o for o in orders if business_date(o.created_at) == business_date()]
    completed = [o for o in today if o.status == "ACTIVATED"]
    checks = context["checks"][agent.id] if context is not None else db.scalars(select(Ekyc).where(Ekyc.agent_id == agent.id)).all()
    stock_count = context["stock"].get(agent.id, 0) if context is not None else db.scalar(select(func.count()).select_from(Sim).where(Sim.agent_id == agent.id, Sim.status == "AVAILABLE"))
    shift = agent.id in context["shifts"] if context is not None else db.scalar(select(Shift).where(Shift.agent_id == agent.id, Shift.ended_at.is_(None)))
    outlet = db.get(Outlet, agent.outlet_id)
    return {
        **{k: v for k, v in raw(agent).items() if k not in {"lat", "lng", "accuracy", "geofence"}},
        "branch_id": outlet.branch_id,
        "branch": db.get(Branch, outlet.branch_id).name,
        "name": db.get(User, agent.user_id).name,
        "leader": db.get(User, agent.leader_id).name if agent.leader_id else None,
        "outlet": db.get(Outlet, agent.outlet_id).name,
        "activations": len(completed),
        "achievement": round(len(completed) / agent.target * 100),
        "aht": round(sum(o.handling_seconds for o in completed) / max(1, len(completed)) / 60, 1),
        "ekyc_rate": round(
            sum(e.status == "VERIFIED" for e in checks) / max(1, len(checks)) * 100, 1
        ),
        "ocr": round(sum(e.confidence for e in checks) / max(1, len(checks)), 1),
        "stock": stock_count,
        "on_shift": bool(shift),
    }
