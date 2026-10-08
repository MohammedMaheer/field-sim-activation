import hashlib
import os
import secrets
from datetime import timedelta
import bcrypt
import jwt
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from .db import User, Role, Permission, Session, Agent, Outlet, now, get_db
from .role_policy import ROLE_PERMISSIONS

SECRET = os.getenv("JWT_SECRET") or secrets.token_hex(48)
KEY = os.getenv("PII_KEY")
if not KEY:
    from pathlib import Path

    key_file = Path(".pii-key")
    if not key_file.exists():
        key_file.write_bytes(Fernet.generate_key())
    KEY = key_file.read_bytes()
cipher = Fernet(KEY)
bearer = HTTPBearer(auto_error=False)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(value):
    return bcrypt.hashpw(value.encode(), bcrypt.gensalt()).decode()


KNOWN_ROLES = set(ROLE_PERMISSIONS)
GLOBAL_AGENT_ROLES = {"Administrator", "Operations Manager", "Compliance Officer", "Inventory Manager", "Sales Manager"}
CAPTURE_WRITERS = {"Administrator", "Operations Manager", "Field Agent"}


def permissions(db, user):
    role = db.get(Role, user.role_id)
    if not role or role.name not in KNOWN_ROLES:
        return set()
    granted = set(db.scalars(select(Permission.name).where(Permission.role_id == user.role_id))) - {
        "location.write", "territory.write",
    }
    # Old database grants must not let reporting roles alter customer evidence.
    if role.name not in CAPTURE_WRITERS:
        granted -= {"ekyc.write", "activation.write"}
    if role.name not in {"Administrator", "Operations Manager", "Compliance Officer"}:
        granted.discard("compliance.write")
    return granted & set(ROLE_PERMISSIONS[role.name])


def require(db, user, permission):
    if permission not in permissions(db, user):
        raise HTTPException(403, "Your role cannot perform this action")


def principal(credentials: HTTPAuthorizationCredentials = Depends(bearer), db=Depends(get_db)):
    try:
        token = jwt.decode(credentials.credentials, SECRET, algorithms=["HS256"], audience="relay")
        session = db.get(Session, token["sid"])
        if not session or session.revoked or session.expires < now():
            raise ValueError("Session expired")
        user = db.get(User, token["sub"])
        if not user or session.user_id != user.id or not permissions(db, user):
            raise ValueError("Invalid subject")
        agent = db.scalar(select(Agent).where(Agent.user_id == user.id))
        if agent and agent.employment_status != "ACTIVE":
            raise ValueError("Agent account inactive")
        return user
    except (AttributeError, ValueError, KeyError, jwt.PyJWTError):
        raise HTTPException(401, "Session expired. Please sign in again.")


def issue(db, user, device):
    refresh = secrets.token_urlsafe(48)
    session = Session(
        user_id=user.id,
        refresh_hash=digest(refresh),
        device=device,
        expires=now() + timedelta(days=7),
    )
    db.add(session)
    db.flush()
    return tokens(user, session), refresh


def tokens(user, session):
    return jwt.encode(
        {"sub": user.id, "sid": session.id, "aud": "relay", "exp": now() + timedelta(minutes=15)},
        SECRET,
        algorithm="HS256",
    )


def visible_agents(db, user):
    role = db.get(Role, user.role_id).name
    query = select(Agent.id)
    if role in {"Tele Verification Officer", "Welcome Call Officer"}:
        return []
    if role == "Field Agent":
        query = query.where(Agent.user_id == user.id)
    elif role == "Team Leader":
        query = query.where(Agent.leader_id == user.id)
    elif role == "Branch Manager":
        query = query.join(Outlet, Outlet.id == Agent.outlet_id).where(
            Outlet.branch_id == user.branch_id
        )
    elif role not in GLOBAL_AGENT_ROLES:
        return []
    return list(db.scalars(query))


def assert_agent(db, user, agent_id):
    if agent_id not in visible_agents(db, user):
        raise HTTPException(404, "Record not found")


def lifecycle_row_for_update(db, model, record_id):
    # Refresh cached assignments and fail promptly rather than wait in an inverted
    # stock/agent/branch lock cycle. Rollback releases any stock locks held already.
    try:
        return db.scalar(select(model).where(model.id == record_id)
                         .with_for_update(nowait=True).execution_options(populate_existing=True))
    except OperationalError as error:
        if getattr(error.orig, "sqlstate", None) != "55P03" and getattr(error.orig, "pgcode", None) != "55P03":
            raise
        db.rollback()
        raise HTTPException(409, "This assignment is being updated. Refresh and try again.") from None


def agent_for_update(db, agent_id):
    return lifecycle_row_for_update(db, Agent, agent_id)


def active_agent(db, agent_id):
    # Serialize new assignments with exit/transfer so closed accounts cannot acquire stock.
    agent = agent_for_update(db, agent_id)
    if not agent or agent.employment_status != "ACTIVE":
        raise HTTPException(422, "Choose an active agent for this stock assignment")
    return agent


def user_view(db, user):
    agent = db.scalar(select(Agent).where(Agent.user_id == user.id))
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": db.get(Role, user.role_id).name,
        "permissions": sorted(permissions(db, user)),
        "agent_id": agent.id if agent else None,
    }
