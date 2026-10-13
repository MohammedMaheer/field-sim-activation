"""Additive evaluation maintenance must never become an operational reset."""
import json

import pytest
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker

# Initialize the shared disposable test environment before any global app engine.
import test_client_scope as shared  # noqa: F401

from app.db import (Base, Agent, Audit, Branch, CallAttempt, CaptureIdentityClaim, Customer,
                    FieldTask, KycCapture, Outlet, Permission, Plan, Product, Role,
                    SalesCallTask, SalesRecord, SalesTarget, Sim, SupportTicket, User, now)
from app import commissions, email_delivery, location_tracking, sr_verification  # noqa: F401
from app.captures import Intake, payload
from app.demo_expansion import DEMO_ACCOUNTS, expand_demo, sample_id
from app.location_tracking import LocationPolicy, WorkFence, WorkLocation, WorkSession
from app.role_policy import ROLE_PERMISSIONS
from app.sales_management import ORDER_TYPES, call_timing, permitted, sale_view, scoped
from app.security import cipher


@pytest.fixture
def sample_db(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "evaluation82.db"))

    @event.listens_for(engine, "connect")
    def fk(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setenv("RELAY_DEMO_EXPANSION", "1")
    monkeypatch.setenv("DEMO_PASSWORD", "isolated-evaluation-password")
    with factory.begin() as db:
        roles = {}
        for name, perms in ROLE_PERMISSIONS.items():
            role = Role(name=name)
            db.add(role)
            db.flush()
            roles[name] = role.id
            db.add_all(Permission(role_id=role.id, name=p) for p in perms)
        people = {}
        for name, email, role in [("Alex Morgan", "admin@relay.demo", "Administrator"),
                                  ("Noor Avery", "compliance@relay.demo", "Compliance Officer")]:
            person = User(name=name, email=email, role_id=roles[role], password_hash="preserved-hash")
            db.add(person)
            db.flush()
            people[email] = person
        for index, name in enumerate(["Marina Branch", "Downtown Branch"]):
            branch = Branch(name=name)
            db.add(branch)
            db.flush()
            outlet = Outlet(name=name, area="Not recorded", branch_id=branch.id, lat=0, lng=0)
            db.add(outlet)
            db.flush()
            leader = User(name=f"Retained Leader {index+1}", email=f"leader{index+1}@relay.demo",
                password_hash="preserved-leader-hash", role_id=roles["Team Leader"], branch_id=branch.id)
            person = User(name=f"Retained Agent {index+1}", email=f"agent{index+1}@relay.demo",
                password_hash="preserved-agent-hash", role_id=roles["Field Agent"], branch_id=branch.id)
            db.add_all([leader, person])
            db.flush()
            agent = Agent(user_id=person.id, employee_id=f"EXISTING-{index+1}", leader_id=leader.id,
                          outlet_id=outlet.id, lat=0, lng=0, status="OFFLINE", geofence="NOT RECORDED")
            db.add(agent)
            db.flush()
            db.add(SalesRecord(agent_id=agent.id, leader_id=leader.id, branch_id=branch.id,
                outlet_id=outlet.id, order_type="NEW", request_id=f"SAMPLE-REQ-PRESERVED-{index+1}",
                customer_name="Saved mobile demo customer", plan_name="Owner edited plan", status="IN_PROGRESS",
                details={"sr_number": f"SAMPLE-SR-PRESERVED-{index+1}", "saved_values": ["keep", 82]}))
        product = Product(name="Preserved product")
        db.add(product)
        db.flush()
        db.add(Plan(name="Owner edited plan", product_id=product.id, monthly_cost=399,
                    data_gb=500, promotion="Preserved owner benefits", active=True))
        db.add(LocationPolicy(enabled=True))
        # A real administrator-entered boundary remains exactly as configured;
        # the expansion must never add or move a fence or invent staff GPS.
        db.add(WorkFence(name="Configured boundary", branch_id=branch.id,
                         latitude=20, longitude=40, radius_m=175, enabled=True))
        db.add(Audit(user_id=people["admin@relay.demo"].id, actor="Alex Morgan", role="Administrator",
                     action="Preserved audit", entity="Saved history"))
    yield factory
    engine.dispose()


def rows_snapshot(factory):
    with factory() as db:
        return {table.name: {row["id"]: {k: str(v) for k, v in row.items()}
                            for row in db.execute(select(table)).mappings()}
                for table in Base.metadata.sorted_tables if "id" in table.c}


def test_expansion_is_bounded_idempotent_and_preserves_every_existing_row(sample_db):
    before = rows_snapshot(sample_db)
    result = expand_demo(sample_db)
    assert result["added"]["users"] == 6
    assert result["added"]["agents"] == 4
    assert result["added"]["sales_records"] == 9
    assert result["added"]["kyc_captures"] == 9
    assert result["added"]["sales_targets"] == 28
    assert result["added"]["sim_inventory"] == 16
    assert result["added"]["support_tickets"] == 4
    assert result["emails_queued"] == 0
    assert result["location_data_created"] is False
    after = rows_snapshot(sample_db)
    for table, values in before.items():
        for key, value in values.items():
            assert after[table][key] == value, (table, key)
    again = expand_demo(sample_db)
    assert again["added"] == {}
    assert again["added_total"] == 0
    assert rows_snapshot(sample_db) == after
    with sample_db() as db:
        for branch in db.scalars(select(Branch)):
            leaders = list(db.scalars(select(User).join(Role).where(
                User.branch_id == branch.id, Role.name == "Team Leader")))
            assert len(leaders) == 2
            assignments = {a.leader_id for a in db.scalars(select(Agent).join(Outlet).where(Outlet.branch_id == branch.id))}
            assert assignments == {leader.id for leader in leaders}
        assert db.scalar(select(func.count()).select_from(WorkLocation)) == 0
        assert db.scalar(select(func.count()).select_from(WorkSession)) == 0
        assert db.scalar(select(func.count()).select_from(email_delivery.EmailOutbox)) == 0
        assert db.scalar(select(func.count()).select_from(FieldTask)) == 0


def test_examples_match_current_evidence_sr_calls_stock_and_role_scopes(sample_db):
    expand_demo(sample_db)
    with sample_db() as db:
        sales = list(db.scalars(select(SalesRecord).where(SalesRecord.request_id.like("DEMO-82-REQ-%"))))
        assert {s.order_type for s in sales} == set(ORDER_TYPES)
        assert {s.status for s in sales} == {"CLOSED", "CANCELLED", "IN_PROGRESS"}
        assert {s.details["router_fulfilment"] for s in sales if s.order_type == "HW"} == {"DELIVERY", "ON_SPOT", "WITHOUT_ROUTER"}
        assert {s.status for s in db.scalars(select(sr_verification.SrCheck))} == {"MATCHED", "MISMATCH", "PENDING_SR_VERIFICATION"}
        assert {s.status for s in db.scalars(select(KycCapture))} == {"VERIFIED", "SUBMITTED", "REJECTED"}
        for sale in sales:
            capture = db.get(KycCapture, sale.capture_id)
            data = payload(capture)
            Intake.model_validate(data["intake"]).complete()
            assert data["synthetic"] is True
            assert data["intake"]["sr_number"] == sale.details["sr_number"]
            assert data["intake"]["order_reference"] == sale.request_id
            assert sale.details["customer_id"]
            assert db.get(Customer, sale.details["customer_id"]).name == sale.customer_name
            assert db.scalar(select(CaptureIdentityClaim.id).where(CaptureIdentityClaim.sale_id == sale.id))
            check = db.scalar(select(sr_verification.SrCheck).where(sr_verification.SrCheck.sale_id == sale.id))
            batch = db.get(sr_verification.SrBatch, check.batch_id)
            assert batch.business_date == check.business_date
            tasks = {t.stage: t for t in db.scalars(select(SalesCallTask).where(SalesCallTask.sale_id == sale.id))}
            if sale.order_type in {"WASEL", "VISITOR"}:
                assert not tasks
            elif sale.status == "CLOSED":
                assert tasks["TELE_VERIFICATION"].status == "COMPLETED"
                assert tasks["WELCOME_CALL"].status in {"COMPLETED", "PENDING"}
            else:
                assert tasks["TELE_VERIFICATION"].status == "PENDING"
                assert tasks["WELCOME_CALL"].status == "BLOCKED"
            if sale.status in {"CLOSED", "CANCELLED"} and sale.order_type != "ELIFE":
                sim = db.get(Sim, sale.details["stock_deducted_sim_id"])
                assert sim.status == "ACTIVATED"
                assert sim.serial == data["intake"]["sim_identifier"]
                assert db.get(Outlet, sim.outlet_id).branch_id == sale.branch_id
            if sale.details.get("tele_deferred_until"):
                assert call_timing(sale, "TELE_VERIFICATION")["deferred"]
        assert any(s.status == "CLOSED" and sale_view(db, s)["sr_status"] == "MISMATCH" for s in sales)
        assert db.scalar(select(CallAttempt.id).where(CallAttempt.stage == "WELCOME_CALL"))
        for email, role in DEMO_ACCOUNTS.items():
            person = db.scalar(select(User).where(User.email == email))
            assert db.get(Role, person.role_id).name == role
            visible = list(db.scalars(scoped(db, person, SalesRecord)))
            assert visible
            assert all(permitted(db, person, sale) for sale in visible)
            if role == "Field Agent":
                agent = db.scalar(select(Agent).where(Agent.user_id == person.id))
                assert all(s.agent_id == agent.id for s in visible)
            else:
                assert all(s.leader_id == person.id for s in visible)


def test_rerun_preserves_manual_edits_and_reassignment(sample_db):
    expand_demo(sample_db)
    with sample_db.begin() as db:
        agent = db.get(Agent, sample_id("agent", 1))
        moved_to = db.get(Agent, sample_id("agent", 4))
        agent.leader_id, agent.outlet_id = moved_to.leader_id, moved_to.outlet_id
        person = db.get(User, agent.user_id)
        person.name, person.password_hash = "Manager edited name", "Manager changed password"
        person.branch_id = db.get(Outlet, moved_to.outlet_id).branch_id
        db.get(SalesTarget, sample_id("target", f"1/{now():%Y-%m}/NEW")).daily_target = 7
        sale = db.get(SalesRecord, sample_id("sale", 1))
        sale.details = {**sale.details, "owner_note": "Preserve evidence and saved leader"}
    before = rows_snapshot(sample_db)
    assert expand_demo(sample_db)["added"] == {}
    assert rows_snapshot(sample_db) == before


def test_requires_opt_in_without_changing_database(sample_db, monkeypatch):
    before = rows_snapshot(sample_db)
    monkeypatch.delenv("RELAY_DEMO_EXPANSION")
    with pytest.raises(RuntimeError, match="Explicit"):
        expand_demo(sample_db)
    assert rows_snapshot(sample_db) == before


@pytest.mark.parametrize("failure", ["missing_password", "reserved_email"])
def test_prerequisite_failure_rolls_back_all_new_records(sample_db, monkeypatch, failure):
    if failure == "missing_password":
        monkeypatch.delenv("DEMO_PASSWORD")
    else:
        with sample_db.begin() as db:
            role_id = db.scalar(select(Role.id).where(Role.name == "Team Leader"))
            db.add(User(name="Existing manually created account", email="demo.leader.2@relay.demo",
                        role_id=role_id, password_hash="preserved"))
    before = rows_snapshot(sample_db)
    with pytest.raises(RuntimeError):
        expand_demo(sample_db)
    assert rows_snapshot(sample_db) == before
