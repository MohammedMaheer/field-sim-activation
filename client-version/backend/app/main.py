import asyncio
import csv
import io
import json
import os
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
import bcrypt
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, or_, text
from .db import *
from .security import *
from .services import *
from . import providers
from .captures import router as capture_router, process_capture
from .proposal import router as proposal_router
from .organization import router as organization_router
from .client_scope import configure as configure_client_scope


async def worker():
    while True:
        await asyncio.sleep(3)
        try:
            await asyncio.to_thread(finish_pending)
        except Exception:
            import logging

            logging.getLogger("relay.worker").error(
                "Activation worker failed; persisted orders will retry"
            )


async def capture_worker():
    while True:
        await asyncio.sleep(2)
        try:
            await asyncio.to_thread(process_capture)
        except Exception:
            import logging

            logging.getLogger("relay.ocr").error(
                "OCR job could not complete; persisted queue will retry"
            )


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(worker())
    ocr_task = asyncio.create_task(capture_worker())
    yield
    task.cancel()
    ocr_task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    try:
        await ocr_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Relay Operations API", version="1.0.0", lifespan=lifespan)
app.include_router(capture_router)
app.include_router(proposal_router)
app.include_router(organization_router)
origin = os.getenv("WEB_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Device-ID"],
)
limits = defaultdict(deque)


@app.middleware("http")
async def safeguards(request: Request, call_next):
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.headers.get("origin")
        and request.headers["origin"] != origin
    ):
        return Response("Origin not allowed", status_code=403)
    key = (
        request.client.host if request.client else "",
        "login"
        if request.url.path == "/api/auth/login"
        else "session"
        if request.url.path.startswith("/api/auth")
        else "api",
    )
    window = limits[key]
    stamp = time.monotonic()
    while window and stamp - window[0] > 60:
        window.popleft()
    if len(window) >= {"login": 30, "session": 120, "api": 600}[key[1]]:
        return Response(
            "Too many requests. Try again shortly.", status_code=429, headers={"Retry-After": "60"}
        )
    window.append(stamp)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


class Login(BaseModel):
    email: str = Field(max_length=180)
    password: str = Field(min_length=1, max_length=72)
    device: str = Field(default="Web", max_length=100)
    native: bool = False


class Refresh(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=200)


@app.get("/api/health")
def health(db=Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "provider_mode": "mock", "database": db.bind.dialect.name}


@app.post("/api/auth/login")
def login(body: Login, response: Response, request: Request, db=Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if (
        not user
        or len(body.password.encode()) > 72
        or not bcrypt.checkpw(body.password.encode(), user.password_hash.encode())
    ):
        raise HTTPException(401, "Incorrect email or password")
    access, refresh = issue(db, user, body.device)
    audit(db, user, "Signed In", user.id, request=request)
    db.commit()
    response.set_cookie(
        "relay_refresh",
        refresh,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true"
        or os.getenv("APP_ENV") == "production",
        samesite="strict",
        max_age=604800,
        path="/api/auth",
    )
    return {
        "access_token": access,
        "user": user_view(db, user),
        **({"refresh_token": refresh} if body.native else {}),
    }


@app.post("/api/auth/refresh")
def refresh(body: Refresh, request: Request, response: Response, db=Depends(get_db)):
    value = body.refresh_token or request.cookies.get("relay_refresh", "")
    session = db.scalar(
        select(Session).where(Session.refresh_hash == digest(value)).with_for_update()
    )
    if not session or session.revoked or session.expires < now():
        raise HTTPException(401, "Refresh expired")
    user = db.get(User, session.user_id)
    replacement = secrets.token_urlsafe(48)
    session.refresh_hash = digest(replacement)
    db.commit()
    response.set_cookie(
        "relay_refresh",
        replacement,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true"
        or os.getenv("APP_ENV") == "production",
        samesite="strict",
        max_age=604800,
        path="/api/auth",
    )
    return {
        "access_token": tokens(user, session),
        "user": user_view(db, user),
        **({"refresh_token": replacement} if body.refresh_token else {}),
    }


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user=Depends(principal), db=Depends(get_db)):
    token = jwt.decode(
        request.headers["authorization"].split()[1], SECRET, algorithms=["HS256"], audience="relay"
    )
    db.get(Session, token["sid"]).revoked = True
    audit(db, user, "Signed Out", user.id, request=request)
    db.commit()
    response.delete_cookie("relay_refresh", path="/api/auth")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(principal), db=Depends(get_db)):
    return user_view(db, user)


@app.get("/api/sessions")
def sessions(user=Depends(principal), db=Depends(get_db)):
    return [
        {
            "id": s.id,
            "device": s.device,
            "created_at": s.created_at,
            "expires": s.expires,
            "revoked": s.revoked,
        }
        for s in db.scalars(select(Session).where(Session.user_id == user.id))
    ]


@app.delete("/api/sessions/{session_id}")
def revoke(session_id: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    session = db.get(Session, session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(404, "Session not found")
    session.revoked = True
    audit(db, user, "Session Revoked", session.id, request=request)
    db.commit()
    return {"ok": True}


def records(resource, db, user, branch_id=""):
    """All branch filters intersect the authenticated user scope."""
    require(db, user, "read")
    ids = visible_agents(db, user)
    agents = db.scalars(
        select(Agent).where(Agent.id.in_(ids)).order_by(Agent.employee_id, Agent.id)
    ).all()
    if branch_id:
        agents = [a for a in agents if db.get(Outlet, a.outlet_id).branch_id == branch_id]
        ids = [a.id for a in agents]
    outlet_ids = {a.outlet_id for a in agents}
    if resource == "branches":
        branches = {db.get(Outlet, a.outlet_id).branch_id for a in agents}
        if db.get(Role, user.role_id).name == "Administrator":
            branches = set(db.scalars(select(Branch.id)))
        return [
            {
                **raw(b),
                "agents": sum(db.get(Outlet, a.outlet_id).branch_id == b.id for a in agents),
                "teams": len(
                    {a.leader_id for a in agents if db.get(Outlet, a.outlet_id).branch_id == b.id}
                ),
            }
            for b in db.scalars(select(Branch).where(Branch.id.in_(branches)).order_by(Branch.name))
        ]
    if resource == "agents":
        return [agent_view(db, a) for a in agents]
    if resource in {"orders", "activations"}:
        return order_views(
            db,
            list(
                db.scalars(
                    select(Order).where(Order.agent_id.in_(ids)).order_by(Order.created_at.desc())
                )
            ),
        )
    if resource == "plans":
        return [raw(p) for p in db.scalars(select(Plan))]
    if resource == "outlets":
        if db.get(Role, user.role_id).name == "Administrator":
            outlet_ids = set(db.scalars(select(Outlet.id)))
        return [
            {
                **{k: v for k, v in raw(o).items() if k not in {"lat", "lng"}},
                "agents": sum(a.outlet_id == o.id for a in agents),
                "branch": db.get(Branch, o.branch_id).name,
            }
            for o in db.scalars(select(Outlet).where(Outlet.id.in_(outlet_ids)))
        ]
    if resource == "kyc-transactions":
        return [
            {
                "id": c.id,
                "agent_id": c.agent_id,
                "created_at": c.created_at,
                "source_reference": c.source_reference,
                "status": c.status,
                "agent": db.get(User, db.get(Agent, c.agent_id).user_id).name,
            }
            for c in db.scalars(
                select(KycCapture)
                .where(KycCapture.agent_id.in_(ids))
                .order_by(KycCapture.created_at.desc())
            )
        ]
    if resource == "territories":
        return [
            {
                **raw(t),
                "outlet": db.get(Outlet, t.outlet_id).name,
                "lat": db.get(Outlet, t.outlet_id).lat,
                "lng": db.get(Outlet, t.outlet_id).lng,
            }
            for t in db.scalars(select(Territory).where(Territory.outlet_id.in_(outlet_ids)))
        ]
    if resource == "team-leaders":
        views = [agent_view(db, a) for a in agents]
        team_checks = list(db.scalars(select(Ekyc).where(Ekyc.agent_id.in_(ids))))
        team_completed = [
            o
            for o in db.scalars(
                select(Order).where(Order.agent_id.in_(ids), Order.status == "ACTIVATED")
            )
            if business_date(o.created_at) == business_date()
        ]
        result = []
        pairs = {(a.leader_id, db.get(Outlet, a.outlet_id).branch_id) for a in agents}
        if db.get(Role, user.role_id).name == "Administrator":
            pairs.update(
                (leader.id, leader.branch_id)
                for leader in db.scalars(
                    select(User)
                    .join(Role)
                    .where(Role.name == "Team Leader", User.branch_id.is_not(None))
                )
                if not branch_id or leader.branch_id == branch_id
            )
        for leader_id, team_branch in sorted(pairs):
            members = [
                a for a in views if a["leader_id"] == leader_id and a["branch_id"] == team_branch
            ]
            member_ids = {a["id"] for a in members}
            checks = [e for e in team_checks if e.agent_id in member_ids]
            completed = [o for o in team_completed if o.agent_id in member_ids]
            result.append(
                {
                    "id": leader_id + ":" + team_branch,
                    "leader_id": leader_id,
                    "branch_id": team_branch,
                    "name": db.get(User, leader_id).name,
                    "branch": db.get(Branch, team_branch).name,
                    "agents": len(members),
                    "activations": sum(a["activations"] for a in members),
                    "target": sum(a["target"] for a in members),
                    "stock": sum(a["stock"] for a in members),
                    "active": sum(a["status"] == "ACTIVE" for a in members),
                    "ekyc_rate": round(
                        sum(e.status == "VERIFIED" for e in checks) / max(1, len(checks)) * 100, 1
                    ),
                    "aht": round(
                        sum(o.handling_seconds for o in completed) / max(1, len(completed)) / 60, 1
                    ),
                }
            )
        return result
    models = {
        "customers": Customer,
        "ekyc": Ekyc,
        "inventory": Sim,
        "movements": Movement,
        "compliance": Alert,
        "audit": Audit,
        "locations": Location,
    }
    if resource not in models:
        raise HTTPException(404, "Unknown resource")
    if resource == "audit":
        require(db, user, "audit.read")
    model = models[resource]
    query = select(model).where(model.agent_id.in_(ids)).order_by(model.created_at.desc())
    if resource == "audit" and db.get(Role, user.role_id).name in {
        "Administrator",
        "Operations Manager",
        "Compliance Officer",
    }:
        query = select(Audit).order_by(Audit.created_at.desc())
    result = []
    agent_names = {
        u.id: u.name
        for u in db.scalars(select(User).where(User.id.in_({a.user_id for a in agents})))
    }
    agent_by_id = {a.id: a for a in agents}
    outlet_names = (
        {o.id: o.name for o in db.scalars(select(Outlet).where(Outlet.id.in_(outlet_ids)))}
        if resource == "inventory"
        else {}
    )
    customer_names = (
        {c.id: c.name for c in db.scalars(select(Customer).where(Customer.agent_id.in_(ids)))}
        if resource == "ekyc"
        else {}
    )
    for row in db.scalars(query):
        if resource == "compliance" and any(
            term in row.title.lower() for term in ("territory", "geofence", "location", "boundary")
        ):
            continue
        if resource == "audit" and branch_id and row.agent_id not in ids:
            continue
        item = raw(row)
        if row.agent_id:
            agent = agent_by_id.get(row.agent_id)
            item["agent"] = agent_names.get(agent.user_id, "System") if agent else "System"
        if resource == "customers":
            item["document"] = "•••• •••• DEMO"
            item["mobile"] = "DEMO ••• " + row.mobile[-3:]
        if resource == "ekyc":
            item["customer"] = customer_names.get(row.customer_id, "Unknown")
        if resource == "inventory":
            item["outlet"] = outlet_names.get(row.outlet_id, "Unassigned")
        result.append(item)
    return result


@app.get("/api/resources/{resource}")
def resource_list(resource: str, branch_id: str = "", user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    return records(resource, db, user, branch_id)


@app.get("/api/dashboard")
def dashboard(branch_id: str = "", user=Depends(principal), db=Depends(get_db)):
    agents = records("agents", db, user, branch_id)
    orders = records("orders", db, user, branch_id)
    sims = records("inventory", db, user, branch_id)
    checks = records("ekyc", db, user, branch_id)
    today = business_date()
    completed = [
        o for o in orders if o["status"] == "ACTIVATED" and business_date(o["created_at"]) == today
    ]
    target = sum(a["target"] for a in agents)
    available = [s for s in sims if s["status"] == "AVAILABLE"]
    scope = [a["id"] for a in agents]
    captures = db.scalars(select(KycCapture).where(KycCapture.agent_id.in_(scope))).all()
    tasks = db.scalars(select(FieldTask).where(FieldTask.agent_id.in_(scope))).all()
    incentives = db.scalars(select(Incentive).where(Incentive.agent_id.in_(scope))).all()
    trend = []
    for delta in range(6, -1, -1):
        day = today - timedelta(days=delta)
        trend.append(
            {
                "day": day.strftime("%a"),
                "date": day.isoformat(),
                "activations": sum(
                    o["status"] == "ACTIVATED" and business_date(o["created_at"]) == day
                    for o in orders
                ),
                "target": target,
                "captures": sum(business_date(c.created_at) == day for c in captures),
                "verified": sum(
                    business_date(c.created_at) == day and c.status == "VERIFIED" for c in captures
                ),
            }
        )
    branch_rows = records("branches", db, user, branch_id)
    for branch in branch_rows:
        member_ids = {a["id"] for a in agents if a["branch_id"] == branch["id"]}
        branch["captures"] = sum(c.agent_id in member_ids for c in captures)
        branch["activations"] = sum(
            o["agent_id"] in member_ids and o["status"] == "ACTIVATED" for o in orders
        )
        branch["target"] = sum(a["target"] for a in agents if a["id"] in member_ids)
        branch["today"] = sum(o["agent_id"] in member_ids for o in completed)
    return {
        "branches": branch_rows,
        "capture_statuses": [
            {"name": status, "value": sum(c.status == status for c in captures)}
            for status in (
                "QUEUED",
                "EXTRACTED",
                "VALIDATED",
                "SUBMITTED",
                "VERIFIED",
                "REJECTED",
                "OCR_FAILED",
            )
        ],
        "plan_mix": [
            {
                "name": name,
                "value": sum(o.get("plan") == name for o in orders if o["status"] == "ACTIVATED"),
            }
            for name in sorted(
                {o.get("plan") or "Unspecified" for o in orders if o["status"] == "ACTIVATED"}
            )
        ],
        "task_statuses": [
            {"name": status, "value": sum(t.status == status for t in tasks)}
            for status in ("OPEN", "IN_PROGRESS", "DONE")
        ],
        "capture_total": len(captures),
        "kyc_today": sum(business_date(c.created_at) == today for c in captures),
        "kyc_pending_review": sum(c.status == "SUBMITTED" for c in captures),
        "kyc_verified": sum(c.status == "VERIFIED" for c in captures),
        "tasks_open": sum(t.status != "DONE" for t in tasks),
        "incentive_total": f"{sum((i.amount for i in incentives if i.period == today.strftime('%Y-%m')), Decimal('0')):.2f}",
        "today": len(completed),
        "target": target,
        "achievement": round(len(completed) / max(target, 1) * 100, 1),
        "active": sum(a["status"] == "ACTIVE" for a in agents),
        "aht": round(
            sum(o["handling_seconds"] for o in completed) / max(1, len(completed)) / 60, 1
        ),
        "ekyc": round(
            sum(e["status"] == "VERIFIED" for e in checks) / max(1, len(checks)) * 100, 1
        ),
        "ocr": round(sum(e["confidence"] for e in checks) / max(1, len(checks)), 1),
        "pending": sum(o["status"] in ["SUBMITTED", "PROCESSING", "DRAFT"] for o in orders),
        "failed": sum(o["status"] == "FAILED" for o in orders),
        "stock": len(available),
        "physical": sum(s["sim_type"] == "Physical" for s in available),
        "esim": sum(s["sim_type"] == "eSIM" for s in available),
        "yesterday": trend[-2]["activations"],
        "week": sum(t["activations"] for t in trend),
        "monthly_target": target * 26,
        "trend": trend,
        "agents": agents,
        "recent": orders[:6],
        "teams": records("team-leaders", db, user, branch_id),
        "alerts": records("compliance", db, user, branch_id),
        "outlets": records("outlets", db, user, branch_id),
        "last_sync": now().isoformat() + "Z",
    }


class DraftBody(BaseModel):
    operation_id: str = Field(min_length=8, max_length=80)
    agent_id: str
    plan_id: str | None = None
    sim_id: str | None = None
    ekyc_id: str | None = None
    customer_id: str | None = None
    step: int = Field(default=0, ge=0, le=7)
    name: str = Field(default="", max_length=120)


@app.post("/api/orders/draft")
def draft(body: DraftBody, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "activation.write")
    assert_agent(db, user, body.agent_id)
    if db.bind.dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:operation, 0))"),
            {"operation": body.operation_id},
        )
    for cls, identifier in [(Customer, body.customer_id), (Ekyc, body.ekyc_id), (Sim, body.sim_id)]:
        if identifier:
            obj = db.get(cls, identifier)
            if not obj or obj.agent_id != body.agent_id:
                raise HTTPException(422, "Invalid associated record")
    if body.plan_id and not db.get(Plan, body.plan_id):
        raise HTTPException(422, "Unknown plan")
    order = db.scalar(
        select(Order).where(Order.operation_id == body.operation_id).with_for_update()
    )
    if order:
        assert_agent(db, user, order.agent_id)
        if order.agent_id != body.agent_id:
            raise HTTPException(409, "Draft is no longer editable")
        if order.status != "DRAFT":
            # A mobile retry may arrive after a successful submission whose response was lost.
            same = all(
                getattr(order, key) == getattr(body, key)
                for key in ["plan_id", "sim_id", "ekyc_id", "customer_id"]
            )
            if same and order.status in {"SUBMITTED", "PROCESSING", "ACTIVATED"}:
                return order_view(db, order)
            raise HTTPException(409, "Draft is no longer editable")
    else:
        ref = secrets.token_hex(5).upper()
        order = Order(
            reference=f"RLY-{ref}",
            request_id=f"REQ-{ref}",
            sr_id=f"SR-{ref}",
            msisdn=f"DEMO-MSISDN-{ref}",
            agent_id=body.agent_id,
            operation_id=body.operation_id,
        )
        db.add(order)
        db.flush()
        db.add(OrderEvent(order_id=order.id, actor=user.name, action="Created"))
    for key in ["plan_id", "sim_id", "ekyc_id", "customer_id"]:
        setattr(order, key, getattr(body, key))
    order.draft = {"step": body.step, "name": body.name}
    order.updated_at = now()
    audit(
        db, user, "Draft Saved", order.id, order.agent_id, new={"step": body.step}, request=request
    )
    db.commit()
    return order_view(db, order)


@app.post("/api/orders/{order_id}/submit")
def submit_order(order_id: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    return order_view(db, submit(db, user, order_id, request))


@app.get("/api/activations/{order_id}")
def order_detail(order_id: str, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    assert_agent(db, user, order.agent_id)
    return {
        **order_view(db, order),
        "events": [
            raw(e)
            for e in db.scalars(
                select(OrderEvent)
                .where(OrderEvent.order_id == order_id)
                .order_by(OrderEvent.created_at)
            )
        ],
    }


@app.post("/api/orders/{order_id}/cancel")
def cancel_order(order_id: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "activation.write")
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not order:
        raise HTTPException(404, "Order not found")
    assert_agent(db, user, order.agent_id)
    transition(db, order, "CANCELLED", user.name)
    audit(
        db,
        user,
        "Activation Cancelled",
        order.id,
        order.agent_id,
        new={"status": "CANCELLED"},
        request=request,
    )
    db.commit()
    return order_view(db, order)


class VerifyBody(BaseModel):
    agent_id: str
    name: str = Field(min_length=2, max_length=120)
    document_type: Literal[
        "National Identity Card", "Passport", "Residence Permit", "Other permitted document"
    ]
    document_number: str = Field(min_length=5, max_length=80)
    expiry: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    nationality: str = Field(default="Synthetic UAE resident", max_length=80)
    arabic_name: str = Field(default="", max_length=120)
    scenario: Literal["pass", "review", "fail"] = "pass"


@app.post("/api/ekyc/verify")
def verify(body: VerifyBody, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "ekyc.write")
    assert_agent(db, user, body.agent_id)
    try:
        expiry = date.fromisoformat(body.expiry)
    except ValueError:
        raise HTTPException(422, "Enter a valid expiry date")
    if not body.document_number.startswith("DEMO-"):
        raise HTTPException(
            422, "Demo mode accepts DEMO- identifiers only; do not enter real identity data"
        )
    result = providers.identity.verify(body.scenario)
    if expiry < business_date():
        result["status"] = "FAILED"
        result["reason"] = "Expired ID"
    customer = Customer(
        agent_id=body.agent_id,
        name=body.name,
        arabic_name=body.arabic_name,
        nationality=body.nationality,
        mobile=f"DEMO-{secrets.token_hex(4)}",
    )
    db.add(customer)
    db.flush()
    db.add(
        Document(
            customer_id=customer.id,
            document_type=body.document_type,
            encrypted_number=cipher.encrypt(body.document_number.encode()).decode(),
            expiry=body.expiry,
        )
    )
    check = Ekyc(
        agent_id=body.agent_id,
        customer_id=customer.id,
        status=result["status"],
        confidence=result["confidence"],
        result=result,
    )
    db.add(check)
    db.flush()
    if check.status != "VERIFIED":
        db.add(
            Alert(
                agent_id=body.agent_id,
                title=result.get("reason", "Identity verification requires investigation"),
                severity="REVIEW",
            )
        )
    audit(
        db,
        user,
        "eKYC " + check.status,
        check.id,
        body.agent_id,
        new={"status": check.status, "provider": "MOCK"},
        request=request,
    )
    db.commit()
    return {**raw(check), "customer": customer.name}


class MoveBody(BaseModel):
    status: Literal[
        "WAREHOUSE",
        "ASSIGNED TO TEAM",
        "ASSIGNED TO AGENT",
        "AVAILABLE",
        "RETURNED",
        "DAMAGED",
        "BLOCKED",
    ]
    agent_id: str | None = None
    reason: str = Field(min_length=5, max_length=300)


@app.post("/api/inventory/{sim_id}/move")
def move(
    sim_id: str, body: MoveBody, request: Request, user=Depends(principal), db=Depends(get_db)
):
    sim = db.scalar(select(Sim).where(Sim.id == sim_id).with_for_update())
    if not sim:
        raise HTTPException(404, "SIM not found")
    if sim.agent_id:
        assert_agent(db, user, sim.agent_id)
    elif sim.outlet_id not in {
        a.outlet_id for a in db.scalars(select(Agent).where(Agent.id.in_(visible_agents(db, user))))
    }:
        raise HTTPException(404, "SIM not found")
    if "inventory.write" not in permissions(db, user):
        require(db, user, "inventory.self")
        if not sim.agent_id:
            raise HTTPException(404, "SIM not assigned to this agent")
        if body.status not in {"RETURNED", "DAMAGED"} or body.agent_id not in {None, sim.agent_id}:
            raise HTTPException(403, "Only return or damage reporting is permitted")
    if sim.status in {"ACTIVATED", "RESERVED", "BLOCKED", "DAMAGED"}:
        raise HTTPException(409, "This SIM cannot be moved from its current state")
    if body.agent_id:
        assert_agent(db, user, body.agent_id)
    assigned_agent = None
    if body.agent_id or sim.agent_id:
        assigned_agent = db.scalar(
            select(Agent).where(Agent.id == (body.agent_id or sim.agent_id)).with_for_update()
        )
    old = {"status": sim.status, "agent_id": sim.agent_id}
    if sim.status == body.status and (not body.agent_id or body.agent_id == sim.agent_id):
        raise HTTPException(409, "No inventory change requested")
    sim.status = body.status
    if body.agent_id:
        sim.agent_id = body.agent_id
        sim.outlet_id = assigned_agent.outlet_id
        sim.assigned_at = now()
    db.add(
        Movement(
            sim_id=sim.id,
            agent_id=sim.agent_id,
            user_id=user.id,
            old_status=old["status"],
            new_status=sim.status,
            reason=body.reason,
        )
    )
    audit(
        db,
        user,
        "Stock Transferred",
        sim.id,
        sim.agent_id,
        old,
        {"status": sim.status, "agent_id": sim.agent_id},
        body.reason,
        request,
    )
    db.commit()
    return raw(sim)


class ShiftBody(BaseModel):
    action: Literal["start", "end"]


@app.post("/api/agents/{agent_id}/shift")
def shift(
    agent_id: str, body: ShiftBody, request: Request, user=Depends(principal), db=Depends(get_db)
):
    require(db, user, "shift.write")
    assert_agent(db, user, agent_id)
    agent = db.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
    active = db.scalar(select(Shift).where(Shift.agent_id == agent_id, Shift.ended_at.is_(None)))
    if body.action == "start" and not active:
        db.add(Shift(agent_id=agent_id))
        agent.status = "ACTIVE"
    elif body.action == "end" and active:
        active.ended_at = now()
        agent.status = "OFFLINE"
    agent.last_sync = now()
    audit(db, user, "Shift " + body.action, agent_id, agent_id, request=request)
    db.commit()
    return agent_view(db, agent)


class LocationBody(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float = Field(gt=0, le=10000)


@app.post("/api/agents/{agent_id}/location")
def location(agent_id: str, body: LocationBody, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "location.write")
    assert_agent(db, user, agent_id)
    agent = db.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
    active_shift = db.scalar(
        select(Shift).where(Shift.agent_id == agent_id, Shift.ended_at.is_(None))
    )
    if not active_shift:
        raise HTTPException(409, "Location tracking is disabled outside an active shift")
    outlet = db.get(Outlet, agent.outlet_id)
    territory = db.scalar(select(Territory).where(Territory.outlet_id == outlet.id))
    distance = distance_m(body.lat, body.lng, outlet.lat, outlet.lng)
    state = classify_location(distance, territory.radius, body.accuracy, territory.tolerance)
    if territory.polygon and body.accuracy <= 100:
        state = (
            "IN BOUNDS"
            if polygon_contains(body.lat, body.lng, territory.polygon)
            else "OUT OF BOUNDS"
        )
    # Measure the entire uninterrupted breach, not the interval between GPS samples.
    last_safe = db.scalar(
        select(Location.created_at)
        .where(Location.agent_id == agent_id, Location.status != "OUT OF BOUNDS")
        .order_by(Location.created_at.desc())
        .limit(1)
    )
    breach_query = select(Location).where(
        Location.agent_id == agent_id,
        Location.status == "OUT OF BOUNDS",
        Location.created_at >= active_shift.created_at,
    )
    if last_safe:
        breach_query = breach_query.where(Location.created_at > last_safe)
    breach_start = db.scalar(breach_query.order_by(Location.created_at).limit(1))
    db.add(
        Location(
            agent_id=agent_id,
            lat=body.lat,
            lng=body.lng,
            accuracy=body.accuracy,
            distance=distance,
            status=state,
        )
    )
    if state != "LOW ACCURACY":
        if state != "OUT OF BOUNDS" or (
            breach_start and (now() - breach_start.created_at).total_seconds() >= 15
        ):
            if agent.geofence != state:
                audit(
                    db,
                    user,
                    "Geofence Status Changed",
                    agent.id,
                    agent.id,
                    {"status": agent.geofence},
                    {"status": state},
                )
                if state == "OUT OF BOUNDS":
                    db.add(
                        Alert(
                            agent_id=agent_id,
                            title="Sustained territory boundary breach",
                            severity="WARNING",
                        )
                    )
            agent.geofence = state
        agent.lat = body.lat
        agent.lng = body.lng
        agent.accuracy = body.accuracy
    agent.last_sync = now()
    db.add(Event(agent_id=agent.id, kind="Agent Location Updated", entity_id=agent.id))
    db.commit()
    return {
        "status": state,
        "effective_status": agent.geofence,
        "distance": round(distance),
        "accuracy": body.accuracy,
    }


@app.post("/api/agents/{agent_id}/ping")
def ping(agent_id: str, request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "device.ping")
    assert_agent(db, user, agent_id)
    agent = db.get(Agent, agent_id)
    db.add(
        Notification(user_id=agent.user_id, message="Operations requested a device synchronization")
    )
    audit(db, user, "Device Ping Requested", agent_id, agent_id, request=request)
    db.commit()
    return {
        "status": "QUEUED",
        "provider": "MOCK",
        "message": "Sync request saved. Push delivery is simulated.",
    }


class ReviewBody(BaseModel):
    status: Literal["INVESTIGATING", "RESOLVED"]
    note: str = Field(min_length=5, max_length=500)


@app.patch("/api/compliance/{alert_id}")
def review(
    alert_id: str, body: ReviewBody, request: Request, user=Depends(principal), db=Depends(get_db)
):
    require(db, user, "compliance.write")
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    assert_agent(db, user, alert.agent_id)
    old = alert.status
    alert.status = body.status
    alert.note = body.note
    audit(
        db,
        user,
        "Compliance Review",
        alert.id,
        alert.agent_id,
        {"status": old},
        {"status": body.status},
        body.note,
        request,
    )
    db.commit()
    return raw(alert)


class PlanBody(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    monthly_cost: float = Field(ge=0, le=100000)
    data_gb: int = Field(ge=0, le=100000)
    active: bool = True
    speed: str = Field(default="5G", max_length=50)
    roaming: str = Field(default="2 GB", max_length=60)
    contract: str = Field(default="12 months", max_length=60)
    promotion: str = Field(default="", max_length=120)
    advance: float = Field(default=0, ge=0, le=100000)
    vat: float = Field(default=5, ge=0, le=100)


@app.patch("/api/plans/{plan_id}")
def edit_plan(
    plan_id: str, body: PlanBody, request: Request, user=Depends(principal), db=Depends(get_db)
):
    require(db, user, "settings.write")
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    old = body.model_dump()
    old = {k: getattr(plan, k) for k in old}
    for k, v in body.model_dump().items():
        setattr(plan, k, v)
    audit(db, user, "Plan Changed", plan.id, old=old, new=body.model_dump(), request=request)
    db.commit()
    return raw(plan)


class AgentEdit(BaseModel):
    target: int = Field(ge=1, le=1000)
    outlet_id: str
    leader_id: str


@app.patch("/api/agents/{agent_id}")
def edit_agent(
    agent_id: str, body: AgentEdit, request: Request, user=Depends(principal), db=Depends(get_db)
):
    require(db, user, "settings.write")
    assert_agent(db, user, agent_id)
    agent = db.get(Agent, agent_id)
    leader = db.get(User, body.leader_id)
    outlet = db.get(Outlet, body.outlet_id)
    if not outlet or not leader or db.get(Role, leader.role_id).name != "Team Leader":
        raise HTTPException(422, "Select a valid outlet and team leader")
    old = {k: getattr(agent, k) for k in type(body).model_fields}
    for k, v in body.model_dump().items():
        setattr(agent, k, v)
    audit(
        db,
        user,
        "Agent Assignment Changed",
        agent.id,
        agent.id,
        old,
        body.model_dump(),
        request=request,
    )
    db.commit()
    return agent_view(db, agent)


class AgentManagement(BaseModel):
    target: int = Field(ge=1, le=1000)
    outlet_id: str
    leader_id: str
    expected_target: int
    expected_outlet_id: str
    expected_leader_id: str
    reason: str = Field(min_length=5, max_length=300)


def admin_only(db, user):
    if db.get(Role, user.role_id).name != "Administrator":
        raise HTTPException(403, "Only an administrator can manage agent assignments")


@app.get("/api/agents/{agent_id}/management")
def agent_management(agent_id: str, user=Depends(principal), db=Depends(get_db)):
    admin_only(db, user)
    assert_agent(db, user, agent_id)
    return {
        "agent": agent_view(db, db.get(Agent, agent_id)),
        "outlets": [
            {
                "id": o.id,
                "name": o.name,
                "branch_id": o.branch_id,
                "branch": db.get(Branch, o.branch_id).name,
            }
            for o in db.scalars(select(Outlet).order_by(Outlet.name))
        ],
        "leaders": [
            {"id": u.id, "name": u.name, "branch_id": u.branch_id}
            for u in db.scalars(
                select(User)
                .join(Role, User.role_id == Role.id)
                .where(Role.name == "Team Leader")
                .order_by(User.name)
            )
        ],
    }


@app.patch("/api/agents/{agent_id}/management")
def save_agent_management(
    agent_id: str,
    body: AgentManagement,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    admin_only(db, user)
    assert_agent(db, user, agent_id)
    agent = db.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
    old = {k: getattr(agent, k) for k in ("target", "outlet_id", "leader_id")}
    if any(old[k] != getattr(body, "expected_" + k) for k in old):
        raise HTTPException(409, "Assignment changed. Reopen management before saving.")
    outlet, leader = db.get(Outlet, body.outlet_id), db.get(User, body.leader_id)
    if not outlet or not leader or db.get(Role, leader.role_id).name != "Team Leader":
        raise HTTPException(422, "Select a valid outlet and team leader")
    if leader.branch_id != outlet.branch_id:
        raise HTTPException(422, "Choose a team leader belonging to the outlet branch")
    if len(body.reason.strip()) < 5:
        raise HTTPException(422, "Enter a meaningful reason")
    # Prevent moving stock silently across outlets; use the audited inventory workflow first.
    if outlet.id != agent.outlet_id and db.scalar(
        select(Sim.id)
        .where(
            Sim.agent_id == agent.id, Sim.status.in_(["AVAILABLE", "ASSIGNED TO AGENT", "RESERVED"])
        )
        .limit(1)
    ):
        raise HTTPException(
            409,
            "Return or transfer the agent's available/reserved SIM stock before changing outlet",
        )
    for key in old:
        setattr(agent, key, getattr(body, key))
    db.get(User, agent.user_id).branch_id = outlet.branch_id
    audit(
        db,
        user,
        "Agent Assignment Changed",
        agent.id,
        agent.id,
        old,
        {k: getattr(agent, k) for k in old},
        body.reason.strip(),
        request,
    )
    db.commit()
    return agent_view(db, agent)


class TerritoryEdit(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    radius: int = Field(ge=25, le=100000)
    tolerance: int = Field(ge=0, le=1000)
    polygon: list[list[float]] = Field(default_factory=list, max_length=200)


@app.patch("/api/territories/{territory_id}")
def edit_territory(
    territory_id: str,
    body: TerritoryEdit,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    require(db, user, "settings.write")
    territory = db.get(Territory, territory_id)
    if not territory:
        raise HTTPException(404, "Territory not found")
    if body.polygon and (
        len(body.polygon) < 3
        or any(
            len(p) != 2 or not -180 <= p[0] <= 180 or not -90 <= p[1] <= 90 for p in body.polygon
        )
    ):
        raise HTTPException(422, "Polygon must have at least three longitude/latitude pairs")
    if body.tolerance >= body.radius:
        raise HTTPException(422, "Tolerance must be smaller than radius")
    old = {k: getattr(territory, k) for k in type(body).model_fields}
    for k, v in body.model_dump().items():
        setattr(territory, k, v)
    audit(
        db, user, "Territory Changed", territory.id, old=old, new=body.model_dump(), request=request
    )
    db.commit()
    return raw(territory)


class OutletEdit(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    area: str = Field(min_length=2, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


@app.patch("/api/outlets/{outlet_id}")
def edit_outlet(
    outlet_id: str, body: OutletEdit, request: Request, user=Depends(principal), db=Depends(get_db)
):
    require(db, user, "settings.write")
    outlet = db.get(Outlet, outlet_id)
    if not outlet:
        raise HTTPException(404, "Outlet not found")
    old = {k: getattr(outlet, k) for k in type(body).model_fields}
    for k, v in body.model_dump().items():
        setattr(outlet, k, v)
    audit(db, user, "Outlet Changed", outlet.id, old=old, new=body.model_dump(), request=request)
    db.commit()
    return raw(outlet)


@app.get("/api/roles")
def roles(user=Depends(principal), db=Depends(get_db)):
    require(db, user, "settings.write")
    return [
        {
            "id": r.id,
            "name": r.name,
            "permissions": list(
                db.scalars(select(Permission.name).where(Permission.role_id == r.id))
            ),
        }
        for r in db.scalars(select(Role))
    ]


class PermissionBody(BaseModel):
    permissions: list[str] = Field(max_length=20)


@app.patch("/api/roles/{role_id}")
def update_role(
    role_id: str,
    body: PermissionBody,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    require(db, user, "settings.write")
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    if role.name == "Administrator":
        raise HTTPException(409, "Administrator recovery permissions are protected")
    allowed = {
        "read",
        "activation.write",
        "inventory.write",
        "inventory.self",
        "report.read",
        "audit.read",
        "device.ping",
        "compliance.write",
        "shift.write",
        "location.write",
    }
    if not set(body.permissions) <= allowed:
        raise HTTPException(422, "Unsupported permission")
    old = list(db.scalars(select(Permission.name).where(Permission.role_id == role_id)))
    db.execute(delete(Permission).where(Permission.role_id == role_id))
    for p in set(body.permissions):
        db.add(Permission(role_id=role_id, name=p))
    audit(
        db,
        user,
        "Role Permissions Changed",
        role_id,
        old={"permissions": old},
        new={"permissions": body.permissions},
        request=request,
    )
    db.commit()
    return {"ok": True}


@app.get("/api/events")
def events(since: str = "", user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    ids = visible_agents(db, user)
    query = (
        select(Event)
        .where(or_(Event.agent_id.in_(ids), Event.agent_id.is_(None)))
        .order_by(Event.created_at)
    )
    if since:
        try:
            query = query.where(
                Event.created_at
                > __import__("datetime").datetime.fromisoformat(since.replace("Z", ""))
            )
        except ValueError:
            raise HTTPException(422, "Invalid event cursor")
    return [raw(e) for e in db.scalars(query.limit(500))]


@app.get("/api/events/stream")
async def event_stream(request: Request, user=Depends(principal), db=Depends(get_db)):
    require(db, user, "read")
    token = jwt.decode(
        request.headers["authorization"].split()[1], SECRET, algorithms=["HS256"], audience="relay"
    )
    session_id = token["sid"]
    user_id = user.id

    async def stream():
        cursor = now()
        yield "event: connected\ndata: {}\n\n"
        while not await request.is_disconnected():
            with DB() as connection:
                session = connection.get(Session, session_id)
                if (
                    not session
                    or session.revoked
                    or session.expires < now()
                    or time.time() > token["exp"]
                ):
                    return
                current = connection.get(User, user_id)
                if not current or "read" not in permissions(connection, current):
                    return
                ids = visible_agents(connection, current)
                items = connection.scalars(
                    select(Event)
                    .where(
                        Event.created_at > cursor,
                        or_(Event.agent_id.in_(ids), Event.agent_id.is_(None)),
                    )
                    .order_by(Event.created_at)
                ).all()
                for event in items:
                    cursor = event.created_at
                    yield f"data: {json.dumps(raw(event))}\n\n"
            yield ": heartbeat\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )


REPORTS = {
    "daily": "orders",
    "monthly": "orders",
    "agent": "agents",
    "team": "team-leaders",
    "outlet": "outlets",
    "branch": "branches",
    "ekyc": "kyc-transactions",
    "geofence": "locations",
    "inventory": "inventory",
    "movement": "movements",
    "failed": "orders",
    "audit": "audit",
}


def pdf_bytes(title, rows, subtitle):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    styles["Normal"].fontSize = 9
    styles["Normal"].leading = 12
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4), rightMargin=30, leftMargin=30, topMargin=35, bottomMargin=35
    )
    story = [
        Paragraph("RELAY | " + escape(title), styles["Title"]),
        Paragraph(escape(subtitle), styles["Normal"]),
        Spacer(1, 16),
    ]
    if rows and "reference" in rows[0]:
        keys = ["reference", "customer", "agent", "outlet", "plan", "status", "created_at"]
        counts = {
            state: sum(r.get("status") == state for r in rows)
            for state in ["ACTIVATED", "PROCESSING", "FAILED", "DRAFT"]
        }
        story.extend(
            [
                Paragraph(
                    " | ".join(f"{state.title()}: {count}" for state, count in counts.items()),
                    styles["Heading3"],
                ),
                Spacer(1, 12),
            ]
        )
    else:
        keys = [k for k in (rows[0] if rows else {}) if k not in {"id", "created_at"}][:7]
    data = [[Paragraph(k.replace("_", " ").title(), styles["Normal"]) for k in keys]]
    for row in rows:
        values = []
        for k in keys:
            cell = row.get(k, "")
            value = (
                (f"{cell:.6f}" if k in {"lat", "lng"} else f"{cell:.1f}")
                if isinstance(cell, float)
                else str(cell)
            )
            if k.endswith("_at") and value:
                value = value[:16].replace("T", " ") + " UTC"
            values.append(Paragraph(escape(value[:180]), styles["Normal"]))
        data.append(values)
    if keys:
        table = Table(data, repeatRows=1, colWidths=[780 / len(keys)] * len(keys))
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eedee5")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#f6f7f9")],
                    ),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#761b3a")),
                ]
            )
        )
        story.append(table)
    else:
        story.append(Paragraph("No records match the selected filters.", styles["Normal"]))

    def footer(canvas, doc):
        canvas.setFont("Helvetica", 8)
        canvas.drawString(30, 20, "Relay Operations | Synthetic demo data | Confidential")
        canvas.drawRightString(810, 20, f"Page {doc.page}")

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


@app.get("/api/reports/{report}")
def export(
    report: str,
    format: Literal["csv", "pdf"] = "csv",
    q: str = "",
    status: str = "",
    start: str = "",
    end: str = "",
    branch_id: str = "",
    user=Depends(principal),
    db=Depends(get_db),
):
    require(db, user, "report.read")
    if report not in REPORTS:
        raise HTTPException(404, "Unknown report")
    try:
        for value in (start, end):
            if value:
                date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "Use valid dates in YYYY-MM-DD format")
    if start and end and start > end:
        raise HTTPException(422, "From date must not be after to date")
    rows = records(REPORTS[report], db, user, branch_id)
    if report == "failed":
        rows = [r for r in rows if r.get("status") == "FAILED"]
    if report == "daily" and not start:
        start = business_date().isoformat()
        end = start
    if report == "monthly" and not start:
        start = business_date().replace(day=1).isoformat()

    def in_period(row):
        day = business_date(row["created_at"]).isoformat()
        return (not start or day >= start) and (not end or day <= end)

    performance = report in {"agent", "team", "outlet", "branch"}
    if performance:
        orders = [r for r in records("orders", db, user, branch_id) if in_period(r)]
        agents = records("agents", db, user, branch_id)
        checks = [r for r in records("ekyc", db, user, branch_id) if in_period(r)]
        for row in rows:
            members = {
                a["id"]
                for a in agents
                if (
                    a["id"] == row["id"]
                    if report == "agent"
                    else a["outlet_id"] == row["id"]
                    if report == "outlet"
                    else a["branch_id"] == row["id"]
                    if report == "branch"
                    else a["leader_id"] == row["leader_id"] and a["branch_id"] == row["branch_id"]
                )
            }
            completed = [
                o for o in orders if o["agent_id"] in members and o["status"] == "ACTIVATED"
            ]
            verified = [e for e in checks if e["agent_id"] in members]
            row["activations"] = len(completed)
            row["aht"] = round(
                sum(o["handling_seconds"] for o in completed) / max(len(completed), 1) / 60, 1
            )
            row["ekyc_rate"] = round(
                sum(e["status"] == "VERIFIED" for e in verified) / max(len(verified), 1) * 100, 1
            )
            row.pop("achievement", None)
    rows = [
        r
        for r in rows
        if (not q or q.lower() in json.dumps(r).lower())
        and (not status or r.get("status") == status)
        and (performance or in_period(r))
    ]
    excluded = {
        "id",
        "agent_id",
        "user_id",
        "customer_id",
        "plan_id",
        "sim_id",
        "ekyc_id",
        "operation_id",
        "outlet_id",
        "leader_id",
        "role_id",
        "branch_id",
        "product_id",
        "result",
        "draft",
        "encrypted_number",
    }
    rows = [
        {k: v for k, v in r.items() if k not in excluded and not isinstance(v, (dict, list))}
        for r in rows
    ]
    subtitle = f"Generated {now():%d %b %Y %H:%M} UTC | {len(rows)} records | Dates: {start or 'all'} to {end or 'all'} | Status: {status or 'all'} | Search: {q or 'none'}"
    if branch_id:
        subtitle += " | Branch: " + (
            db.get(Branch, branch_id).name if db.get(Branch, branch_id) else "No matching branch"
        )
    if performance:
        subtitle += " | Activations/AHT/eKYC use selected dates; targets and stock are current."
    audit(db, user, "Report Exported", report, new={"format": format, "rows": len(rows)})
    db.commit()
    if format == "pdf":
        data = pdf_bytes(report.title() + " report", rows, subtitle)
        media = "application/pdf"
    else:
        buffer = io.StringIO()
        keys = (
            list(dict.fromkeys(k for row in rows for k in row)) if rows else ["No matching records"]
        )
        writer = csv.DictWriter(buffer, fieldnames=keys)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    k: "'" + str(v) if str(v).startswith(("=", "+", "-", "@", "\t", "\r")) else v
                    for k, v in row.items()
                }
            )
        data = buffer.getvalue().encode("utf-8-sig")
        media = "text/csv"
    return Response(
        data,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="relay-{report}.{format}"'},
    )


@app.get("/api/orders/{order_id}/receipt")
def receipt(order_id: str, user=Depends(principal), db=Depends(get_db)):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    assert_agent(db, user, order.agent_id)
    view = order_view(db, order)
    rows = [
        {"Field": k.replace("_", " ").title(), "Value": view[k]}
        for k in [
            "reference",
            "request_id",
            "sr_id",
            "msisdn",
            "customer",
            "plan",
            "agent",
            "outlet",
            "created_at",
            "status",
        ]
    ]
    return Response(
        pdf_bytes("Activation receipt", rows, "Demo provider transaction — no payment collected"),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{order.reference}.pdf"'},
    )


configure_client_scope(app)
