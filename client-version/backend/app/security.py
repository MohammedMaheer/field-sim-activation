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
from .db import User, Role, Permission, Session, Agent, Outlet, now, get_db

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


def permissions(db, user):
    return set(db.scalars(select(Permission.name).where(Permission.role_id == user.role_id))) - {
        "location.write",
        "territory.write",
    }


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
        if not user or session.user_id != user.id:
            raise ValueError("Invalid subject")
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
    if role == "Field Agent":
        query = query.where(Agent.user_id == user.id)
    elif role == "Team Leader":
        query = query.where(Agent.leader_id == user.id)
    elif role == "Branch Manager":
        query = query.join(Outlet, Outlet.id == Agent.outlet_id).where(
            Outlet.branch_id == user.branch_id
        )
    return list(db.scalars(query))


def assert_agent(db, user, agent_id):
    if agent_id not in visible_agents(db, user):
        raise HTTPException(404, "Record not found")


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
