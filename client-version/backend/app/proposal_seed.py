"""Idempotent synthetic proposal records for an already seeded demo database."""

from datetime import timedelta
from sqlalchemy import select
from .db import Agent, FieldTask, Incentive, DB, business_date


def seed_proposal():
    with DB() as db:
        agents = db.scalars(select(Agent).order_by(Agent.employee_id)).all()
        day = business_date()
        for index, agent in enumerate(agents):
            if not db.scalar(select(FieldTask.id).where(FieldTask.agent_id == agent.id).limit(1)):
                db.add_all([
                    FieldTask(agent_id=agent.id, title="Review today's KYC queue", note="Check pending transaction captures.", due_date=day.isoformat()),
                    FieldTask(agent_id=agent.id, title="Confirm assigned SIM stock", note="Reconcile stock before shift end.", due_date=(day + timedelta(days=1)).isoformat()),
                ])
            if not db.scalar(select(Incentive.id).where(Incentive.agent_id == agent.id).limit(1)):
                db.add(Incentive(agent_id=agent.id, period=day.strftime("%Y-%m"), amount=125 + index * 15, note="Synthetic monthly incentive example", source="DEMO"))
        db.commit()


if __name__ == "__main__":
    seed_proposal()
