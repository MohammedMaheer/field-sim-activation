"""Administrator provisioning for the branch / leader / agent hierarchy."""

import re
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from .db import Agent, Branch, Outlet, Role, User, Session, get_db
from .security import lifecycle_row_for_update, principal, password_hash
from .services import audit

router = APIRouter(prefix="/api/organization")


def administrator(db, user):
    if db.get(Role, user.role_id).name not in {"Administrator", "Operations Manager"}:
        raise HTTPException(403, "Only administrators and backend staff can manage the organization")


def leader_view(db, leader):
    return {
        "id": leader.id,
        "name": leader.name,
        "email": leader.email,
        "branch_id": leader.branch_id,
        "agents": db.scalar(select(func.count()).select_from(Agent).where(Agent.leader_id == leader.id)),
    }


def select_agent_leader(db, branch_id, leader_id, *, required=False):
    """An explicit reporting line remains independent of the branch's leader list."""
    if not leader_id and required:
        raise HTTPException(422, "Select a designated team leader assigned to this branch")
    leader = lifecycle_row_for_update(db, User, leader_id) if leader_id else None
    role = db.get(Role, leader.role_id) if leader else None
    if leader_id and (not leader or not role or role.name != "Team Leader"
                      or leader.branch_id != branch_id):
        raise HTTPException(422, "Select a team leader assigned to this branch")
    return leader


def capture_assignment(db, agent_id):
    """New intake requires an active branch and its explicitly designated leader."""
    from .branch_lifecycle import active_branch
    from .security import active_agent
    agent = active_agent(db, agent_id)
    outlet = db.get(Outlet, agent.outlet_id)
    if not outlet:
        raise HTTPException(422, "Assign this sales agent to an active branch before recording a sale")
    active_branch(db, outlet.branch_id)
    try:
        select_agent_leader(db, outlet.branch_id, agent.leader_id, required=True)
    except HTTPException as error:
        if error.status_code != 422:
            raise
        raise HTTPException(422, "Management must assign a valid branch team leader to this sales agent before recording a new sale") from None
    return agent, outlet


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
        "leaders": [leader_view(db, leader) for leader in leaders],
    }


class Creation(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    branch_id: str = Field(default="", max_length=36)
    leader_id: str = Field(default="", max_length=36)
    leader_ids: list[str] = Field(default_factory=list, max_length=100)
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
    if body.leader_ids and kind != "branches":
        raise HTTPException(422, "Choose a single reporting team leader for a sales agent")
    if kind != "branches":
        if not db.get(Branch, body.branch_id):
            raise HTTPException(422, "Select a valid branch")
        from .branch_lifecycle import active_branch
        active_branch(db, body.branch_id)
        values["branch_id"] = body.branch_id
    if kind == "branches":
        if db.scalar(select(Branch.id).where(func.lower(Branch.name) == body.name.lower())):
            raise HTTPException(409, "A branch with this name already exists")
        identifiers = set(body.leader_ids)
        if len(identifiers) != len(body.leader_ids):
            raise HTTPException(422, "Choose each team leader once")
        selected = db.scalars(select(User).where(User.id.in_(sorted(identifiers)))
                              .order_by(User.id).with_for_update()).all()
        if len(selected) != len(identifiers) or any(
            db.get(Role, person.role_id).name != "Team Leader" for person in selected
        ):
            raise HTTPException(422, "Choose valid team leaders")
        if any(person.branch_id for person in selected):
            raise HTTPException(409, "A selected team leader is already assigned to a branch")
        entity = Branch(name=body.name)
        db.add(entity)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "This record already exists. Refresh and try again.") from None
        db.add(Outlet(name=body.name, branch_id=entity.id, area="", lat=0, lng=0))
        for person in selected:
            person.branch_id = entity.id
        if identifiers:
            for session in db.scalars(select(Session).where(Session.user_id.in_(identifiers))):
                session.revoked = True
            values["leader_ids"] = sorted(identifiers)
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
            outlet = (
                db.get(Outlet, body.outlet_id)
                if body.outlet_id
                else db.scalar(
                    select(Outlet)
                    .where(Outlet.branch_id == body.branch_id)
                    .order_by(Outlet.created_at)
                )
            )
            if not outlet or outlet.branch_id != body.branch_id:
                raise HTTPException(422, "This branch has no valid assignment")
            leader = select_agent_leader(db, body.branch_id, body.leader_id, required=True)
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
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "This record already exists. Refresh and try again.") from None
        entity = (
            account
            if kind == "teams"
            else Agent(
                user_id=account.id,
                employee_id=body.employee_id.upper(),
                leader_id=leader.id if leader else None,
                outlet_id=outlet.id,
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


class LeaderAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    leader_id: str


class BranchLeaders(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    leader_ids: list[str] = Field(max_length=100)
    expected_leader_ids: list[str] = Field(max_length=100)
    reason: str = Field(min_length=5, max_length=300)


def branch_leaders(db, branch_id):
    return db.scalars(select(User).join(Role).where(
        Role.name == "Team Leader", User.branch_id == branch_id
    ).order_by(User.name, User.id)).all()


@router.get("/branches/{branch_id}/leaders")
def leader_management(branch_id: str, db=Depends(get_db), user=Depends(principal)):
    administrator(db, user)
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(404, "Branch not found")
    return {
        "branch": {"id": branch.id, "name": branch.name},
        "leaders": [leader_view(db, person) for person in branch_leaders(db, branch_id)],
        "available_leaders": [leader_view(db, person) for person in db.scalars(
            select(User).join(Role).where(Role.name == "Team Leader", User.branch_id.is_(None))
            .order_by(User.name, User.id)
        )],
    }


@router.put("/branches/{branch_id}/leaders")
def save_branch_leaders(branch_id: str, body: BranchLeaders, request: Request,
                        db=Depends(get_db), user=Depends(principal)):
    administrator(db, user)
    db.execute(select(Role).where(Role.id == user.role_id).with_for_update()).scalar_one()
    branch = db.scalar(select(Branch).where(Branch.id == branch_id).with_for_update())
    if not branch:
        raise HTTPException(404, "Branch not found")
    from .branch_lifecycle import active_branch
    active_branch(db, branch_id)
    current = branch_leaders(db, branch_id)
    old_ids = {person.id for person in current}
    new_ids = set(body.leader_ids)
    if len(new_ids) != len(body.leader_ids):
        raise HTTPException(422, "Choose each team leader once")
    if old_ids != set(body.expected_leader_ids):
        raise HTTPException(409, "Branch team leaders changed. Reload before saving.")
    chosen = db.scalars(select(User).where(User.id.in_(sorted(new_ids | old_ids)))
                        .order_by(User.id).with_for_update().execution_options(populate_existing=True)).all()
    chosen_by_id = {person.id: person for person in chosen}
    if any(identifier not in chosen_by_id or
           db.get(Role, chosen_by_id[identifier].role_id).name != "Team Leader"
           for identifier in new_ids):
        raise HTTPException(422, "Choose valid team leaders")
    if any(chosen_by_id[identifier].branch_id not in {None, branch_id} for identifier in new_ids):
        raise HTTPException(409, "A selected team leader is assigned to another branch")
    removed_ids = old_ids - new_ids
    if removed_ids and db.scalar(select(Agent.id).where(Agent.leader_id.in_(removed_ids)).limit(1)):
        raise HTTPException(409, "Reassign the team leader's sales agents before removing their branch assignment")
    for identifier in new_ids - old_ids:
        chosen_by_id[identifier].branch_id = branch_id
    for identifier in removed_ids:
        chosen_by_id[identifier].branch_id = None
    changed_ids = old_ids ^ new_ids
    if changed_ids:
        for session in db.scalars(select(Session).where(Session.user_id.in_(changed_ids))):
            session.revoked = True
        audit(db, user, "Branch team leaders updated", branch_id,
              old={"leader_ids": sorted(old_ids)}, new={"leader_ids": sorted(new_ids)},
              reason=body.reason, request=request)
    db.commit()
    return {"branch_id": branch_id, "leader_ids": sorted(new_ids),
            "leaders": [leader_view(db, person) for person in branch_leaders(db, branch_id)]}


@router.put("/branches/{branch_id}/leader")
def assign_leader(
    branch_id: str,
    body: LeaderAssignment,
    request: Request,
    db=Depends(get_db),
    user=Depends(principal),
):
    administrator(db, user)
    db.execute(select(Role).where(Role.id == user.role_id).with_for_update()).scalar_one()
    from .branch_lifecycle import active_branch
    branch = active_branch(db, branch_id)
    leader = db.scalar(select(User).where(User.id == body.leader_id).with_for_update())
    if not branch or not leader or db.get(Role, leader.role_id).name != "Team Leader":
        raise HTTPException(422, "Choose a branch and team leader")
    if leader.branch_id and leader.branch_id != branch_id:
        raise HTTPException(409, "Team leader is assigned to another branch")
    before = leader.branch_id
    leader.branch_id = branch_id
    if before != branch_id:
        for session in db.scalars(select(Session).where(Session.user_id == leader.id)):
            session.revoked = True
    audit(
        db, user, "Branch leader assigned", branch_id,
        old={"leader_id": leader.id, "branch_id": before},
        new={"leader_id": leader.id, "branch_id": branch_id}, request=request
    )
    db.commit()
    return {"branch_id": branch_id, "leader_id": leader.id}
