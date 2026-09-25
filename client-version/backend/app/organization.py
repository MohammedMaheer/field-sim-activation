"""Administrator provisioning for the branch / leader / agent hierarchy."""

import re
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from .db import Agent, Branch, Outlet, Role, User, get_db
from .security import principal, password_hash
from .services import audit

router = APIRouter(prefix="/api/organization")


def administrator(db, user):
    if db.get(Role, user.role_id).name != "Administrator":
        raise HTTPException(403, "Only administrators can manage the organization")


@router.get("")
def directory(db=Depends(get_db), user=Depends(principal)):
    administrator(db, user)
    leaders = db.scalars(
        select(User).join(Role).where(Role.name == "Team Leader").order_by(User.name)
    ).all()
    return {
        "branches": [
            {"id": b.id, "name": b.name} for b in db.scalars(select(Branch).order_by(Branch.name))
        ],
        "outlets": [
            {"id": o.id, "name": o.name, "branch_id": o.branch_id}
            for o in db.scalars(select(Outlet).order_by(Outlet.name))
        ],
        "teams": [
            {"id": leader.id, "name": leader.name + "’s team", "branch_id": leader.branch_id}
            for leader in leaders
        ],
    }


class Creation(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    branch_id: str = Field(default="", max_length=36)
    leader_id: str = Field(default="", max_length=36)
    outlet_id: str = Field(default="", max_length=36)
    email: str = Field(default="", max_length=180)
    password: str = Field(default="", max_length=72)
    employee_id: str = Field(default="", max_length=40)
    target: int = Field(default=20, ge=1, le=1000)
    area: str = Field(default="", max_length=120)


@router.post("/{kind}", status_code=201)
def create(
    kind: Literal["branches", "outlets", "teams", "agents"],
    body: Creation,
    request: Request,
    db=Depends(get_db),
    user=Depends(principal),
):
    administrator(db, user)
    # Serialize provisioning without changing the existing membership model.
    db.execute(select(Role).where(Role.id == user.role_id).with_for_update()).scalar_one()
    values = {"name": body.name}
    if kind != "branches":
        if not db.get(Branch, body.branch_id):
            raise HTTPException(422, "Select a valid branch")
        values["branch_id"] = body.branch_id
    if kind == "branches":
        if db.scalar(select(Branch.id).where(func.lower(Branch.name) == body.name.lower())):
            raise HTTPException(409, "A branch with this name already exists")
        entity = Branch(name=body.name)
    elif kind == "outlets":
        if db.scalar(
            select(Outlet.id).where(
                Outlet.branch_id == body.branch_id, func.lower(Outlet.name) == body.name.lower()
            )
        ):
            raise HTTPException(409, "This outlet already exists in the branch")
        entity = Outlet(**values, area=body.area, lat=0, lng=0)
    else:
        email = body.email.lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise HTTPException(422, "Enter a valid email address")
        if len(body.password) < 10 or len(body.password.encode()) > 72:
            raise HTTPException(
                422, "Use a password of at least 10 characters and at most 72 bytes"
            )
        if db.scalar(select(User.id).where(func.lower(User.email) == email)):
            raise HTTPException(409, "An account with this email already exists")
        if kind == "agents":
            leader = db.get(User, body.leader_id)
            outlet = db.get(Outlet, body.outlet_id)
            if (
                not leader
                or db.get(Role, leader.role_id).name != "Team Leader"
                or leader.branch_id != body.branch_id
            ):
                raise HTTPException(422, "Choose a team from this branch")
            if not outlet or outlet.branch_id != body.branch_id:
                raise HTTPException(422, "Choose an outlet from this branch")
            if not re.fullmatch(r"[A-Za-z0-9_-]{2,40}", body.employee_id):
                raise HTTPException(
                    422, "Employee ID must contain 2–40 letters, numbers, hyphens or underscores"
                )
            if db.scalar(
                select(Agent.id).where(func.lower(Agent.employee_id) == body.employee_id.lower())
            ):
                raise HTTPException(409, "Employee ID already exists")
        role = db.scalar(
            select(Role).where(Role.name == ("Team Leader" if kind == "teams" else "Field Agent"))
        )
        account = User(
            **values, email=email, password_hash=password_hash(body.password), role_id=role.id
        )
        db.add(account)
        db.flush()
        entity = (
            account
            if kind == "teams"
            else Agent(
                user_id=account.id,
                employee_id=body.employee_id.upper(),
                leader_id=body.leader_id,
                outlet_id=body.outlet_id,
                target=body.target,
                lat=0,
                lng=0,
            )
        )
    try:
        db.add(entity)
        db.flush()
        audit(
            db,
            user,
            "Organization " + kind + " created",
            entity.id,
            agent_id=entity.id if kind == "agents" else None,
            new=values,
            request=request,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This record already exists. Refresh and try again.")
    return {"id": entity.id, **values}
