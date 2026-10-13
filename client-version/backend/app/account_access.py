"""Super-admin account/role controls; operational admins do not provision users."""

import re
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from .db import User, Role, Permission, Session, Branch, get_db
from .security import principal, require, password_hash
from .services import audit
from .validation import BusinessInput
from .role_policy import ROLE_PERMISSIONS

router = APIRouter(prefix="/api/organization/access", tags=["Super admin access"])
LABELS = {
    "Administrator": "Super admin",
    "Operations Manager": "Admin",
    "Compliance Officer": "Backend verification",
    "Tele Verification Officer": "Tele-verification",
    "Field Agent": "Sales agent",
}


def access(db, user):
    if db.get(Role, user.role_id).name != "Administrator":
        raise HTTPException(403, "Only the Super admin can manage accounts and role access")
    require(db, user, "read")
    require(db, user, "settings.write")


@router.get("")
def directory(user=Depends(principal), db=Depends(get_db)):
    access(db, user)
    roles = list(db.scalars(select(Role).where(Role.name.in_(ROLE_PERMISSIONS))))
    return {
        "accounts": [
            {
                "id": p.id,
                "name": p.name,
                "email": p.email,
                "role": db.get(Role, p.role_id).name,
                "role_id": p.role_id,
                "branch_id": p.branch_id,
            }
            for p in db.scalars(select(User).order_by(User.name))
        ],
        "roles": [
            {
                "id": r.id,
                "name": r.name,
                "label": LABELS.get(r.name, r.name),
                "permissions": list(
                    db.scalars(select(Permission.name).where(Permission.role_id == r.id))
                ),
                "allowed": ROLE_PERMISSIONS[r.name],
            }
            for r in roles
        ],
    }


class AccountCreate(BusinessInput):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=180)
    password: str = Field(min_length=10, max_length=72)
    role_id: str
    branch_id: str | None = None


@router.post("/accounts", status_code=201)
def create(body: AccountCreate, request: Request, user=Depends(principal), db=Depends(get_db)):
    access(db, user)
    role = db.get(Role, body.role_id)
    if not role or role.name not in ROLE_PERMISSIONS:
        raise HTTPException(422, "Choose a supported role")
    if role.name in {"Field Agent", "Team Leader"}:
        raise HTTPException(
            422, "Use the separate sales agent or team leader form to create branch-linked staff"
        )
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(body.password.encode()) > 72:
        raise HTTPException(422, "Enter a valid email and password of at most 72 bytes")
    if body.branch_id and (
        not db.get(Branch, body.branch_id)
        or db.get(Branch, body.branch_id).lifecycle_status != "ACTIVE"
    ):
        raise HTTPException(422, "Choose an active branch")
    if role.name == "Branch Manager" and not body.branch_id:
        raise HTTPException(422, "A Branch Manager needs an assigned branch")
    row = User(
        name=body.name.strip(),
        email=email,
        password_hash=password_hash(body.password),
        role_id=role.id,
        branch_id=body.branch_id,
    )
    db.add(row)
    try:
        db.flush()
        audit(
            db,
            user,
            "Staff Account Created",
            row.id,
            new={"role": role.name, "email": email, "branch_id": body.branch_id},
            request=request,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists") from None
    return {"id": row.id, "name": row.name, "email": row.email, "role": role.name}


class RoleChange(BusinessInput):
    permissions: list[str] = Field(max_length=100)
    expected: list[str] = Field(max_length=100)
    reason: str = Field(min_length=5, max_length=300)


class AccountChange(BusinessInput):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=180)
    role_id: str
    branch_id: str | None = None
    password: str = Field(default="", max_length=72)
    expected: dict
    reason: str = Field(min_length=5, max_length=300)


@router.put("/accounts/{account_id}")
def edit_account(
    account_id: str,
    body: AccountChange,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    access(db, user)
    # Use one role lock order with access changes before locking a user.
    roles = {role.id: role for role in db.scalars(select(Role).order_by(Role.id).with_for_update())}
    person = db.scalar(select(User).where(User.id == account_id).with_for_update())
    if not person:
        raise HTTPException(404, "Account not found")
    chosen = roles.get(body.role_id)
    if not chosen or chosen.name not in ROLE_PERMISSIONS:
        raise HTTPException(422, "Choose a supported role")
    if {roles[person.role_id].name, chosen.name} & {"Field Agent", "Team Leader"}:
        raise HTTPException(
            422, "Use branch-linked staff forms to edit sales agents or team leaders"
        )
    old = {
        "name": person.name,
        "email": person.email,
        "role_id": person.role_id,
        "branch_id": person.branch_id,
    }
    if old != body.expected:
        raise HTTPException(409, "Account changed. Reload before editing")
    if account_id == user.id and (
        body.role_id != person.role_id or body.branch_id != person.branch_id
    ):
        raise HTTPException(
            409,
            "Keep your own Super admin access and assignment; another Super admin can change it",
        )
    if body.branch_id and (
        not db.get(Branch, body.branch_id)
        or db.get(Branch, body.branch_id).lifecycle_status != "ACTIVE"
    ):
        raise HTTPException(422, "Choose an active branch")
    if chosen.name == "Branch Manager" and not body.branch_id:
        raise HTTPException(422, "A Branch Manager needs an assigned branch")
    email = body.email.casefold()
    if (
        not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)
        or body.password
        and (len(body.password) < 10 or len(body.password.encode()) > 72)
    ):
        raise HTTPException(422, "Use a valid email and a password of 10–72 bytes")
    person.name, person.email, person.role_id, person.branch_id = (
        body.name,
        email,
        body.role_id,
        body.branch_id,
    )
    if body.password:
        person.password_hash = password_hash(body.password)
    for session in db.scalars(select(Session).where(Session.user_id == person.id)):
        session.revoked = True
    audit(
        db,
        user,
        "Staff Account Updated",
        person.id,
        old=old,
        new={
            "name": person.name,
            "email": email,
            "role_id": person.role_id,
            "branch_id": person.branch_id,
            "password_changed": bool(body.password),
        },
        reason=body.reason,
        request=request,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This sign-in email already exists") from None
    return {
        "id": person.id,
        "name": person.name,
        "email": person.email,
        "role_id": person.role_id,
        "branch_id": person.branch_id,
    }


@router.put("/roles/{role_id}")
def change_role(
    role_id: str, body: RoleChange, request: Request, user=Depends(principal), db=Depends(get_db)
):
    access(db, user)
    role = db.scalar(select(Role).where(Role.id == role_id).with_for_update())
    if not role or role.name not in ROLE_PERMISSIONS:
        raise HTTPException(404, "Role not found")
    old = set(db.scalars(select(Permission.name).where(Permission.role_id == role.id)))
    allowed = set(ROLE_PERMISSIONS[role.name])
    chosen = set(body.permissions)
    if chosen - allowed or len(chosen) != len(body.permissions):
        raise HTTPException(422, "Choose only the permissions allowed for this role")
    if old != set(body.expected):
        raise HTTPException(409, "Role access changed. Reload before editing.")
    if role.name == "Administrator" and not {"read", "settings.write"} <= chosen:
        raise HTTPException(409, "Keep Super admin account and access controls enabled")
    if old != chosen:
        db.execute(delete(Permission).where(Permission.role_id == role.id))
        for name in chosen:
            db.add(Permission(role_id=role.id, name=name))
        for session in db.scalars(
            select(Session).join(User, User.id == Session.user_id).where(User.role_id == role.id)
        ):
            session.revoked = True
        audit(
            db,
            user,
            "Role Access Updated",
            role.id,
            old={"permissions": sorted(old)},
            new={"permissions": sorted(chosen)},
            reason=body.reason,
            request=request,
        )
    db.commit()
    return {"id": role.id, "permissions": sorted(chosen)}
