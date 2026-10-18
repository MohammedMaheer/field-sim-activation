"""Real row-lock regressions; explicit disposable PostgreSQL opt-in only."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.db import Agent, Branch, Outlet, User
from app.organization import capture_assignment


@pytest.fixture
def postgres_sessions():
    if os.getenv("RELAY_POSTGRES_LOCK_TESTS") != "1":
        pytest.skip("Opt in only inside the disposable seeded PostgreSQL QA service")
    url = make_url(os.environ["DATABASE_URL"])
    assert url.get_backend_name() == "postgresql"
    assert url.host.startswith("qanawat-") and url.database.endswith("qa")
    engine = create_engine(url, pool_size=3, max_overflow=0, hide_parameters=True)
    try:
        yield sessionmaker(engine)
    finally:
        engine.dispose()


@pytest.mark.parametrize("protected", ["branch", "leader"])
def test_parallel_agent_capture_validation_shares_membership_but_blocks_management(postgres_sessions, protected):
    with postgres_sessions() as db:
        groups = {}
        for agent, branch in db.execute(
            select(Agent, Outlet.branch_id).join(Outlet, Outlet.id == Agent.outlet_id)
            .where(Agent.employment_status == "ACTIVE", Agent.leader_id.is_not(None))
        ):
            groups.setdefault((branch, agent.leader_id), []).append(agent.id)
        (branch_id, leader_id), agents = next((key, rows) for key, rows in groups.items() if len(rows) >= 2)
    entered, release = [Event(), Event()], Event()

    def hold(index):
        with postgres_sessions() as db:
            capture_assignment(db, agents[index])
            entered[index].set()
            assert release.wait(15)

    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(hold, 0)
        try:
            assert entered[0].wait(5), "First capture could not validate assignment"
            second = workers.submit(hold, 1)
            assert entered[1].wait(5), "Unrelated capture was blocked by its shared branch/leader"
            model, identifier = (Branch, branch_id) if protected == "branch" else (User, leader_id)
            with postgres_sessions() as management:
                with pytest.raises(OperationalError) as locked:
                    management.scalar(select(model).where(model.id == identifier).with_for_update(nowait=True))
                assert locked.value.orig.sqlstate == "55P03"
                management.rollback()
        finally:
            release.set()
        first.result(5)
        second.result(5)
    with postgres_sessions() as management:
        assert management.scalar(select(model).where(model.id == identifier).with_for_update(nowait=True))
