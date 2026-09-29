"""Opt-in evaluation staff and one stock batch; existing accounts and plans are untouched."""
import os
from sqlalchemy import select
from .db import DB, Agent, Outlet, Role, User, FieldAsset, FieldAssetMovement, StockThreshold
from .security import password_hash


def seed():
    if os.getenv("RELAY_SEED_OPERATIONS") != "YES":
        raise SystemExit("Set RELAY_SEED_OPERATIONS=YES to add evaluation records")
    with DB() as db:
        agent = db.scalar(select(Agent).where(Agent.employment_status == "ACTIVE").order_by(Agent.employee_id))
        admin = db.scalar(select(User).join(Role).where(Role.name == "Administrator"))
        password = os.getenv("DEMO_PASSWORD")
        if not agent or not admin or not password:
            raise SystemExit("An active agent, administrator and evaluation password are required")
        branch_id = db.get(Outlet, agent.outlet_id).branch_id
        for email, name, role in (("salesmanager", "Nina Hart", "Sales Manager"),
                                  ("tele", "Faris Reed", "Tele Verification Officer"),
                                  ("welcome", "Amina Vale", "Welcome Call Officer")):
            address = f"{email}@relay.demo"
            if not db.scalar(select(User.id).where(User.email == address)):
                role_id = db.scalar(select(Role.id).where(Role.name == role))
                if not role_id:
                    raise SystemExit("Run migration 012 first")
                db.add(User(name=name, email=address, role_id=role_id, branch_id=branch_id,
                            password_hash=password_hash(password)))
        batch = db.scalar(select(FieldAsset).where(FieldAsset.batch == "EVAL-UNIFORM-001"))
        if not batch:
            batch = FieldAsset(category="UNIFORM", label="Staff polo", quantity=4, status="AVAILABLE",
                branch_id=branch_id, warehouse="Central store", batch="EVAL-UNIFORM-001", size="M", condition="New")
            db.add(batch)
            db.flush()
            db.add(FieldAssetMovement(asset_id=batch.id, from_branch_id=branch_id, to_branch_id=branch_id,
                                      actor_id=admin.id, quantity_delta=4, reason="Opening stock balance"))
        if not db.scalar(select(StockThreshold.id).where(StockThreshold.branch_id == branch_id, StockThreshold.category == "UNIFORM")):
            db.add(StockThreshold(branch_id=branch_id, category="UNIFORM", minimum=5, actor_id=admin.id))
        db.commit()


if __name__ == "__main__":
    seed()
