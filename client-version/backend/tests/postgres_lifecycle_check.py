"""Deterministic lifecycle races; run only against an isolated PostgreSQL QA DB.

Set RELAY_QA_DATABASE to a relay_rigorous_qa_* database. DATABASE_URL supplies
the connection and is rewritten to that explicitly allowed database. Each test
uses fresh synthetic records and removes its business records afterwards;
the append-only audit history remains intact.
"""
import base64
import csv
import io
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from unittest.mock import patch

from sqlalchemy import delete, select, text
from sqlalchemy.engine import make_url
from starlette.requests import Request
from fastapi import HTTPException


qa_name = os.environ.get("RELAY_QA_DATABASE", "")
if not re.fullmatch(r"relay_rigorous_qa_\d+", qa_name):
    raise RuntimeError("This check requires an explicitly named isolated QA database")
os.environ["DATABASE_URL"] = make_url(os.environ["DATABASE_URL"]).set(database=qa_name).render_as_string(hide_password=False)

from app.db import Agent, Branch, DB, FieldAsset, FieldAssetMovement, Outlet, Role, SalesTarget, User, engine
from app.field_assets import AgentTransfer, AssetChange, move_asset, transfer_agent
from app.security import active_agent
from app.branch_lifecycle import active_branch
from app import sales_management

if engine.dialect.name != "postgresql":
    raise RuntimeError("Lifecycle contention requires PostgreSQL")

request = Request({"type": "http", "method": "POST", "path": "/qa/lifecycle", "headers": [], "client": ("127.0.0.1", 0)})


def expect_http(code, callback):
    try:
        callback()
    except HTTPException as error:
        assert error.status_code == code, (error.status_code, error.detail)
        return
    raise AssertionError(f"Expected HTTP {code}")


def main():
    token = str(uuid4())[:8]
    branch_ids, outlet_ids, account_ids = [], [], []
    agent_id = asset_id = None
    try:
        with DB() as db:
            admin = db.scalar(select(User).join(Role).where(Role.name == "Administrator"))
            admin_id = admin.id
            leader_role = db.scalar(select(Role.id).where(Role.name == "Team Leader"))
            agent_role = db.scalar(select(Role.id).where(Role.name == "Field Agent"))
            for index in range(2):
                branch = Branch(name=f"Lifecycle race {token}-{index}")
                db.add(branch)
                db.flush()
                branch_ids.append(branch.id)
                outlet = Outlet(name=branch.name, branch_id=branch.id, area="", lat=0, lng=0)
                leader = User(name=f"Lifecycle leader {index}", email=f"lifecycle-leader-{token}-{index}@relay.demo",
                              password_hash="unused-test-account", role_id=leader_role, branch_id=branch.id)
                db.add_all([outlet, leader])
                db.flush()
                outlet_ids.append(outlet.id)
                account_ids.append(leader.id)
            account = User(name="Lifecycle agent", email=f"lifecycle-agent-{token}@relay.demo",
                           password_hash="unused-test-account", role_id=agent_role, branch_id=branch_ids[0])
            db.add(account)
            db.flush()
            account_ids.append(account.id)
            agent = Agent(user_id=account.id, employee_id=f"LOCK-{token}", leader_id=account_ids[0],
                          outlet_id=outlet_ids[0], lat=0, lng=0)
            db.add(agent)
            db.flush()
            agent_id = agent.id
            asset = FieldAsset(category="UNIFORM", label="Lifecycle synthetic stock", branch_id=branch_ids[0],
                               agent_id=agent.id, status="ASSIGNED", quantity=1)
            db.add(asset)
            db.flush()
            asset_id = asset.id
            db.commit()

        # One request holds stock, while an agent transfer holds the agent and
        # waits for that stock. Assignment must return 409 promptly and release
        # the stock lock, allowing the transfer to complete without a deadlock.
        with DB() as assignment, ThreadPoolExecutor(max_workers=1) as executor:
            assignment.execute(text("SET LOCAL statement_timeout = '5s'"))
            assignment.scalar(select(FieldAsset).where(FieldAsset.id == asset_id).with_for_update())

            def transfer():
                with DB() as db:
                    db.execute(text("SET LOCAL application_name = 'relay_lifecycle_transfer_check'"))
                    db.execute(text("SET LOCAL statement_timeout = '5s'"))
                    return transfer_agent(agent_id, AgentTransfer(branch_id=branch_ids[1], stock_action="TRANSFER",
                        reason="Deterministic synthetic agent transfer"), request, user=db.get(User, admin_id), db=db)

            future = executor.submit(transfer)
            waiting = False
            for _ in range(100):
                with DB() as observer:
                    waiting = bool(observer.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='relay_lifecycle_transfer_check' AND wait_event_type='Lock')")))
                if waiting:
                    break
                time.sleep(0.02)
            assert waiting, "Transfer did not reach the controlled stock wait"
            started = time.monotonic()
            expect_http(409, lambda: move_asset(asset_id, AssetChange(branch_id=branch_ids[0], agent_id=agent_id,
                status="ASSIGNED", condition="Should not be applied", reason="Concurrent stock metadata change"), request,
                user=assignment.get(User, admin_id), db=assignment))
            assert time.monotonic() - started < 1.0, "Contention did not fail promptly"
            assert future.result(timeout=6)["transferred"]
        with DB() as db:
            assert db.get(FieldAsset, asset_id).condition == ""
            assert db.get(FieldAsset, asset_id).branch_id == branch_ids[1]
        print("PASS stock assignment versus agent transfer: conflict 409, no partial write, transfer completes")

        # A strongly cached Agent object cannot retain ACTIVE after another
        # transaction closes access, and a cached branch cannot stay ACTIVE.
        with DB() as stale, DB() as changed:
            cached_agent, cached_branch = stale.get(Agent, agent_id), stale.get(Branch, branch_ids[0])
            changed.get(Agent, agent_id).employment_status = "EXITED"
            changed.get(Branch, branch_ids[0]).lifecycle_status = "CLOSING"
            changed.commit()
            expect_http(422, lambda: active_agent(stale, agent_id))
            expect_http(409, lambda: active_branch(stale, branch_ids[0]))
            assert cached_agent.employment_status == "EXITED" and cached_branch.lifecycle_status == "CLOSING"
        with DB() as db:
            db.get(Agent, agent_id).employment_status = "ACTIVE"
            db.get(Branch, branch_ids[0]).lifecycle_status = "ACTIVE"
            db.commit()
        print("PASS cached lifecycle rows refresh after account exit and branch closure")

        # Move the agent exactly between an old leader's initial scope check and
        # the locked write. Both single-target and file writes must recheck scope.
        original_lock = sales_management.agent_for_update
        for imported in (False, True):
            current = 1 if not imported else 0
            destination = 1 - current

            def move_before_lock(db, record_id):
                with DB() as moving:
                    transfer_agent(agent_id, AgentTransfer(branch_id=branch_ids[destination], stock_action="TRANSFER",
                        reason="Transfer between target scope checks"), request, user=moving.get(User, admin_id), db=moving)
                return original_lock(db, record_id)

            with DB() as target_session:
                cached = target_session.get(Agent, agent_id)
                leader = target_session.get(User, account_ids[current])
                with patch.object(sales_management, "agent_for_update", move_before_lock):
                    if imported:
                        content = io.StringIO()
                        writer = csv.writer(content)
                        writer.writerow(sales_management.TARGET_COLUMNS)
                        writer.writerow([cached.employee_id, "2035-11", "ALL", "", "", 3, 60])
                        body = sales_management.StatusFile(filename="targets.csv", apply=True,
                            content_base64=base64.b64encode(content.getvalue().encode()).decode())
                        expect_http(422, lambda: sales_management.target_file(body, request, user=leader, db=target_session))
                    else:
                        body = sales_management.TargetWrite(agent_id=agent_id, period="2035-10", order_type="ALL", daily_target=3, monthly_target=60)
                        expect_http(404, lambda: sales_management.save_target(body, request, user=leader, db=target_session))
            with DB() as db:
                assert not db.scalar(select(SalesTarget.id).where(SalesTarget.agent_id == agent_id))
        print("PASS transferred agent denied to previous leader in single and imported target writes")

        # Held branch locks also return a retryable conflict rather than wait.
        with DB() as holder, DB() as contender:
            holder.scalar(select(Branch).where(Branch.id == branch_ids[0]).with_for_update())
            expect_http(409, lambda: active_branch(contender, branch_ids[0]))
        print("PASS concurrent branch lifecycle lock returns conflict 409")
    finally:
        with DB() as db:
            if asset_id:
                db.execute(delete(FieldAssetMovement).where(FieldAssetMovement.asset_id == asset_id))
                db.execute(delete(FieldAsset).where(FieldAsset.id == asset_id))
            if agent_id:
                db.execute(delete(SalesTarget).where(SalesTarget.agent_id == agent_id))
                db.execute(delete(Agent).where(Agent.id == agent_id))
            if account_ids:
                db.execute(delete(User).where(User.id.in_(account_ids)))
            if outlet_ids:
                db.execute(delete(Outlet).where(Outlet.id.in_(outlet_ids)))
            if branch_ids:
                db.execute(delete(Branch).where(Branch.id.in_(branch_ids)))
            db.commit()


if __name__ == "__main__":
    main()
