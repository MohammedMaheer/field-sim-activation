"""Idempotent sample-only assignment of one leader per branch."""

import os
from sqlalchemy import select
from .db import DB, Branch, User, Role, Agent, Outlet
from .services import audit


def assign_samples():
    if os.getenv("RELAY_ASSIGN_SAMPLE_BRANCH_LEADERS") != "YES":
        raise RuntimeError("Explicit sample maintenance flag required")
    with DB() as db:
        role = db.scalar(select(Role).where(Role.name == "Team Leader"))
        administrator = db.scalar(
            select(User)
            .join(Role)
            .where(Role.name == "Administrator", User.email == "admin@relay.demo")
        )
        leaders = list(
            db.scalars(
                select(User)
                .where(User.role_id == role.id, User.email.like("%@relay.demo"))
                .order_by(User.email)
            )
        )
        if not leaders or not administrator:
            raise RuntimeError("Sample administrator and leader accounts required")
        branches = list(db.scalars(select(Branch).order_by(Branch.created_at, Branch.id)))
        chosen = {}
        spare = []
        for leader in leaders:
            if leader.branch_id and leader.branch_id not in chosen:
                chosen[leader.branch_id] = leader
            else:
                spare.append(leader)
        for branch in branches:
            leader = chosen.get(branch.id)
            if not leader:
                if spare:
                    leader = spare.pop(0)
                else:
                    suffix = 3
                    while db.scalar(
                        select(User.id).where(User.email == f"leader{suffix}@relay.demo")
                    ):
                        suffix += 1
                    leader = User(
                        name=f"{branch.name} Leader",
                        email=f"leader{suffix}@relay.demo",
                        role_id=role.id,
                        password_hash=leaders[0].password_hash,
                    )
                    db.add(leader)
                    db.flush()
                leader.branch_id = branch.id
            for agent in db.scalars(
                select(Agent).join(Outlet).where(Outlet.branch_id == branch.id)
            ):
                agent.leader_id = leader.id
            audit(
                db,
                administrator,
                "Sample branch leader assigned",
                branch.id,
                new={"leader_id": leader.id},
            )
            print(branch.name, leader.email)
        db.commit()


if __name__ == "__main__":
    assign_samples()
