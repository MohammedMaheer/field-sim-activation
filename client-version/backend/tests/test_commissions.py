"""Isolated approved-rate, cancellation, permission and configuration checks."""
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import importlib.util

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.commissions import (
    CommissionConfiguration, CommissionPolicy, SOURCE_POLICIES, gate_component,
    monthly_component, router, run_rates, seed_policies,
)
from app.db import Agent, Audit, Base, Branch, Outlet, Permission, Role, SalesRecord, User, get_db
from app.role_policy import ROLE_PERMISSIONS
from app.security import principal


@pytest.fixture
def commission_context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        roles = {}
        for name, grants in ROLE_PERMISSIONS.items():
            role = Role(name=name)
            db.add(role)
            db.flush()
            roles[name] = role.id
            db.add_all([Permission(role_id=role.id, name=grant) for grant in grants])
        branches = [Branch(name=f"Commission Branch {n}") for n in (1, 2)]
        db.add_all(branches)
        db.flush()
        outlets = [Outlet(name=branch.name, branch_id=branch.id, area="", lat=0, lng=0) for branch in branches]
        db.add_all(outlets)
        db.flush()
        people = {}
        for key, role, branch in [("admin", "Administrator", None), ("ops", "Operations Manager", None),
                                  ("leader1", "Team Leader", branches[0].id), ("leader2", "Team Leader", branches[1].id),
                                  ("agent1", "Field Agent", branches[0].id), ("agent2", "Field Agent", branches[1].id),
                                  ("sm", "Sales Manager", branches[0].id), ("compliance", "Compliance Officer", None),
                                  ("inventory", "Inventory Manager", None), ("tele", "Tele Verification Officer", None)]:
            person = User(name=f"Commission {key}", email=f"commission-{key}@relay.demo", password_hash="unused-test-principal",
                          role_id=roles[role], branch_id=branch)
            db.add(person)
            db.flush()
            people[key] = person
        agents = []
        for n in (1, 2):
            agent = Agent(user_id=people[f"agent{n}"].id, employee_id=f"COM-{n}", outlet_id=outlets[n-1].id,
                          leader_id=people[f"leader{n}"].id, lat=0, lng=0)
            db.add(agent)
            db.flush()
            agents.append(agent)
        seed_policies(db)
        db.commit()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[principal] = lambda: people["admin"]
        with TestClient(app) as client:
            yield {"db": db, "app": app, "client": client, "people": people, "agents": agents, "branches": branches, "outlets": outlets}
    engine.dispose()


def as_role(ctx, key):
    ctx["app"].dependency_overrides[principal] = lambda: ctx["people"][key]


def sales(ctx, count, *, order_type="NEW", status="CLOSED", plan="Plan A", mrc="205", number=1):
    rows = []
    for _ in range(count):
        row = SalesRecord(agent_id=ctx["agents"][number-1].id, leader_id=ctx["people"][f"leader{number}"].id,
                          manager_id=ctx["people"]["sm"].id, branch_id=ctx["branches"][number-1].id,
                          outlet_id=ctx["outlets"][number-1].id, order_type=order_type, customer_name="Incentive test customer",
                          plan_name=plan, status=status, request_id=f"COM-{uuid4()}", details={"monthly_cost": mrc},
                          created_at=datetime(2026, 10, 7, 8))
        ctx["db"].add(row)
        rows.append(row)
    ctx["db"].commit()
    return rows


def staff_inputs(**changes):
    return {"monthly_target": 15, "plan_slabs": {"Plan A": "SLAB_1"}, "staff_bands_confirmed": True,
            "gate_enabled": False, "payout_share_confirmed": True, "payout_share_percent": 100, **changes}


def configure(ctx, *, person="agent1", policy="mbo_staff_oct2026", inputs=None, version=0, period="2026-10"):
    return ctx["client"].put(f"/api/commissions/configurations/{ctx['people'][person].id}/{period}",
                             json={"policy_id": policy, "version": version, "inputs": inputs or staff_inputs(),
                                   "reason": "Approved incentive inputs recorded"})


def summary(ctx, person="agent1"):
    response = ctx["client"].get(f"/api/commissions/summary?period=2026-10&user_id={ctx['people'][person].id}")
    assert response.status_code == 200, response.text
    return response.json()["rows"][0]


def test_exact_policy_tables_and_no_private_source_profiles(commission_context):
    ctx = commission_context
    tables = ctx["client"].get("/api/commissions/policies").json()
    assert len(tables) == 4
    staff = next(row for row in tables if row["family"] == "MBO_STAFF")
    assert staff["rules"]["monthly_rates"] == {"SLAB_1": ["25", "30", "30", "50"], "SLAB_2": ["50", "60", "75", "90"], "SLAB_3": ["75", "90", "100", "125"]}
    tl = next(row for row in tables if row["family"] == "POSTPAID_TL")
    assert tl["rules"]["monthly_rates"]["P2P"]["SLAB_2"] == ["2.5", "5", "5", "10"]
    assert tl["rules"]["elife_rates"]["3P_639"] == ["25", "30", "30", "40"]
    assert "Saad" not in str(tables) and "qanawat.com" not in str(tables)
    assert summary(ctx)["amount"] is None
    assert summary(ctx)["missing_inputs"] == ["policy_assignment"]


@pytest.mark.parametrize("count,slab,rate", [(80,"SLAB_1",25),(90,"SLAB_1",30),(100,"SLAB_1",30),(110,"SLAB_1",50),
                                          (80,"SLAB_2",50),(90,"SLAB_2",60),(100,"SLAB_2",75),(110,"SLAB_2",90),
                                          (80,"SLAB_3",75),(90,"SLAB_3",90),(100,"SLAB_3",100),(110,"SLAB_3",125)])
def test_all_staff_bands_exact_rates(commission_context, count, slab, rate):
    ctx = commission_context
    sales(ctx, count)
    assert configure(ctx, inputs=staff_inputs(monthly_target=100, plan_slabs={"Plan A":slab})).status_code == 200
    result = summary(ctx)
    assert result["status"] == "CALCULATED" and result["amount"] == f"{count*rate:.2f}"


def test_cancellation_recomputes_original_sale_day_and_month(commission_context):
    ctx = commission_context
    rows = sales(ctx, 15)
    assert configure(ctx).status_code == 200
    assert summary(ctx)["amount"] == "450.00"
    for row in rows[:3]:
        row.status = "CANCELLED"
        row.status_updated_at = datetime(2026, 10, 8, 10)
    ctx["db"].commit()
    result = summary(ctx)
    assert result["net_sales"] == 12 and result["cancelled"] == 3
    assert result["amount"] == "300.00"
    assert all(row.created_at.date() == date(2026, 10, 7) for row in rows)
    assert ctx["db"].scalar(select(CommissionConfiguration)).version == 1


def test_staff_fixed_hw_elife_slabs_without_mrc_guessing(commission_context):
    ctx = commission_context
    sales(ctx, 8, order_type="HW", plan="HW unknown price", mrc="")
    sales(ctx, 2, order_type="ELIFE", plan="eLife unknown price", mrc="")
    assert configure(ctx, inputs=staff_inputs(monthly_target=10,plan_slabs={})).status_code == 200
    assert summary(ctx)["amount"] == "800.00"  # HW8×75 + eLife2×100


def test_missing_slab_withholds_payout_and_does_not_use_plan_price(commission_context):
    ctx = commission_context
    sales(ctx, 15, plan="Unmapped package", mrc="350")
    assert configure(ctx).status_code == 200
    result = summary(ctx)
    assert result["amount"] is None and "plan_slabs:Unmapped package" in result["missing_inputs"]


@pytest.mark.parametrize("key", ["agent1", "leader1", "sm", "compliance", "inventory", "tele"])
def test_only_management_can_change_incentive_configuration(commission_context, key):
    ctx = commission_context
    as_role(ctx, key)
    assert configure(ctx).status_code == 403
    assert ctx["db"].scalar(select(CommissionConfiguration)) is None


def test_subject_visibility_is_private_and_foreign_account_query_not_found(commission_context):
    ctx = commission_context
    for key in ("agent1", "leader1"):
        as_role(ctx, key)
        assert [item["id"] for item in ctx["client"].get("/api/commissions/subjects").json()] == [ctx["people"][key].id]
        assert ctx["client"].get(f"/api/commissions/summary?period=2026-10&user_id={ctx['people']['agent2'].id}").status_code == 404
    as_role(ctx, "sm")
    assert len(ctx["client"].get("/api/commissions/subjects").json()) == 5
    for key in ("compliance", "inventory", "tele"):
        as_role(ctx, key)
        assert ctx["client"].get("/api/commissions/summary?period=2026-10").status_code == 403


def test_configuration_version_audit_role_family_and_period_guards(commission_context):
    ctx = commission_context
    first = configure(ctx)
    assert first.status_code == 200 and first.json()["version"] == 1
    assert configure(ctx).status_code == 409
    changed = configure(ctx, version=1, inputs=staff_inputs(monthly_target=20))
    assert changed.status_code == 200 and changed.json()["version"] == 2
    assert len(list(ctx["db"].scalars(select(Audit)))) == 2
    assert configure(ctx,person="leader1",policy="mbo_staff_oct2026").status_code == 422
    assert configure(ctx,period="2026-09").status_code == 422
    assert configure(ctx,person="sm",policy="sm_gate_oct2026",period="2026-11").status_code == 422
    assert configure(ctx,period="2026-99").status_code == 422


@pytest.mark.parametrize("bad", [{"monthly_target":0},{"monthly_target":"NaN"},{"quality_percent":"Infinity"},{"contract_share_percent":101},
                                  {"mrc_thresholds":[1,1,2,3,4,5]},{"staff_gate_targets":[2]},{"plan_slabs":{"A":"SLAB_4"}},
                                  {"plan_slabs":{"A":"SLAB_1"," a ":"SLAB_2"}}, {"gate_scope_branch_ids":["unknown"]},
                                  {"disconnected_sale_ids":["unknown"]}, {"payout_share_percent":0}])
def test_invalid_configuration_never_creates_partial_record(commission_context, bad):
    ctx = commission_context
    assert configure(ctx, inputs=staff_inputs(**bad)).status_code == 422
    assert ctx["db"].scalar(select(CommissionConfiguration)) is None
    assert ctx["db"].scalar(select(Audit)) is None


def test_team_leader_commission_uses_sale_assignment_snapshot(commission_context):
    ctx = commission_context
    sales(ctx, 120, mrc="185")
    inputs = {"contract_share_percent":80,"disconnection_percent":0,"metric_definition":"Approved contract and disconnection monthly report", "gate_enabled":False,"payout_share_confirmed":True,"payout_share_percent":100}
    assert configure(ctx, person="leader1",policy="mbo_tl_oct2026",inputs=inputs).status_code == 200
    ctx["agents"][0].leader_id = ctx["people"]["leader2"].id
    ctx["db"].commit()
    as_role(ctx,"leader1")
    assert summary(ctx,"leader1")["amount"] == "1200.00"
    assert summary(ctx,"leader1")["net_sales"] == 120
    as_role(ctx,"leader2")
    assert summary(ctx,"leader2")["net_sales"] == 0


@pytest.mark.parametrize("mrc,mode,expected", [("210",None,"1380.00"),("230",None,None),("230","HIGHER_ONLY","1440.00"),("230","CUMULATIVE","1620.00"),("180",None,None)])
def test_mbo_tl_mrc_uplifts_and_unknowns(commission_context,mrc,mode,expected):
    ctx=commission_context
    sales(ctx,120,mrc=mrc)
    inputs={"contract_share_percent":80,"disconnection_percent":0,"metric_definition":"Approved monthly metrics", "gate_enabled":False,"payout_share_confirmed":True,"payout_share_percent":100}
    if mode:
        inputs["mbo_uplift_mode"]=mode
    assert configure(ctx,person="leader1",policy="mbo_tl_oct2026",inputs=inputs).status_code == 200
    result=summary(ctx,"leader1")
    assert result["amount"] == expected
    if expected is None:
        assert result["status"] == "CONFIGURATION_REQUIRED"


def test_pp_tl_product_rates_mnp_gate_and_personal_mrc_profile(commission_context):
    ctx=commission_context
    sales(ctx,1,order_type="MNP")
    sales(ctx,9)
    inputs={"monthly_target":10,"mnp_target":1,"contract_share_percent":75,"disconnection_percent":0,
            "metric_definition":"Approved monthly metrics","plan_slabs":{"Plan A":"SLAB_1"},
            "mrc_thresholds":[190,200,205,210,215,220],"mrc_eligibility_floor":190,
            "gate_enabled":False,"payout_share_confirmed":True,"payout_share_percent":100}
    assert configure(ctx,person="leader1",policy="postpaid_tl_oct2026",inputs=inputs).status_code == 200
    assert summary(ctx,"leader1")["amount"] == "27.50"
    result=configure(ctx,person="leader1",policy="postpaid_tl_oct2026",version=1,inputs={**inputs,"mnp_target":2})
    assert result.status_code == 200
    assert summary(ctx,"leader1")["amount"] == "0.00"


def test_disconnections_are_explicit_and_cancelled_sales_always_excluded(commission_context):
    ctx=commission_context
    rows=sales(ctx,150,mrc="185")
    inputs={"contract_share_percent":80,"disconnection_percent":8,"disconnected_sale_ids":[row.id for row in rows[:30]],
            "metric_definition":"Approved monthly metrics","gate_enabled":False,"payout_share_confirmed":True,"payout_share_percent":100}
    assert configure(ctx,person="leader1",policy="mbo_tl_oct2026",inputs=inputs).status_code == 200
    assert summary(ctx,"leader1")["amount"] is None
    inputs["disconnected_sales_confirmed"]=True
    assert configure(ctx,person="leader1",policy="mbo_tl_oct2026",inputs=inputs,version=1).status_code == 200
    assert summary(ctx,"leader1")["amount"] == "1200.00"


def test_elife_is_separate_from_pp_90_percent_eligibility(commission_context):
    ctx=commission_context
    pp=sales(ctx,8,order_type="MNP")
    elife=sales(ctx,1,order_type="ELIFE",plan="eLife399")
    policy=ctx["db"].get(CommissionPolicy,"postpaid_tl_oct2026")
    inputs={"monthly_target":10,"mnp_target":1,"contract_share_percent":75,"disconnection_percent":0,"metric_definition":"Approved metrics",
            "elife_attainment_basis":"ELIFE","elife_target":1,"elife_plan_codes":{"eLife399":"3P_NEO_399"}}
    components=monthly_component(policy,inputs,pp+elife)
    assert components[0]["status"] == "NOT_ELIGIBLE"
    assert components[1]["amount"] == "20.00"


@pytest.mark.parametrize("mode,expected",[("HIGHEST_ONLY","206.46"),("ADDITIVE","375.36")])
def test_staff_gate_exact_mrc_thresholds_allocation_and_no_roundup(commission_context,mode,expected):
    ctx=commission_context
    rows=sales(ctx,3,order_type="MNP",mrc="126")
    policy=ctx["db"].get(CommissionPolicy,"mbo_staff_oct2026")
    inputs={"gate_enabled":True,"contract_share_percent":75,"quality_percent":80,"metric_definition":"Approved monthly gate report",
            "gate_scope_branch_ids":[ctx["branches"][0].id],"staff_gate_targets":[2,3],"gate_mode":mode,"plan_slabs":{"Plan A":"SLAB_3"}}
    result=gate_component(ctx["db"],policy,inputs,rows,datetime(2026,10,1),datetime(2026,11,1),"2026-10")
    assert result["amount"] == expected
    rows[0].details={"monthly_cost":"125"}
    ctx["db"].commit()
    result=gate_component(ctx["db"],policy,inputs,rows,datetime(2026,10,1),datetime(2026,11,1),"2026-10")
    assert result["details"]["aggregate_qualifying_sales"] == 2
    assert result["details"]["achieved_gates"] == ["GATE_1"]
    result=gate_component(ctx["db"],policy,{**inputs,"staff_gate_targets":[Decimal("2.001"),Decimal("3")]},rows,datetime(2026,10,1),datetime(2026,11,1),"2026-10")
    assert result["amount"] == "0.00" and result["details"]["achieved_gates"] == []
    result=gate_component(ctx["db"],policy,{**inputs,"quality_percent":Decimal("79.999")},rows,datetime(2026,10,1),datetime(2026,11,1),"2026-10")
    assert result["status"] == "NOT_ELIGIBLE" and result["amount"] == "0.00"


def test_unknown_mrc_prevents_gate_instead_of_guessing_from_plan(commission_context):
    ctx=commission_context
    rows=sales(ctx,3,mrc="")
    policy=ctx["db"].get(CommissionPolicy,"mbo_staff_oct2026")
    inputs={"gate_enabled":True,"contract_share_percent":75,"quality_percent":80,"metric_definition":"Gate report","gate_scope_branch_ids":[ctx["branches"][0].id],"staff_gate_targets":[2,3],"gate_mode":"HIGHEST_ONLY"}
    result=gate_component(ctx["db"],policy,inputs,rows,datetime(2026,10,1),datetime(2026,11,1),"2026-10")
    assert result["amount"] is None and result["missing_inputs"] == ["gate_captured_monthly_charge"]


def test_approved_crr_drr_zero_denominator_and_unconfigured_projection():
    assert run_rates(12,31,"2026-10",date(2026,10,8)) == {"days_gone":8,"days_remaining":23,"crr":"1.5","drr":str(Decimal(19)/23),"projection":None,"projection_status":"FORMULA_REQUIRED"}
    assert run_rates(0,30,"2026-11",date(2026,10,9))["crr"] is None
    assert run_rates(40,30,"2026-10",date(2026,10,31))["drr"] is None
    assert Decimal(run_rates(40,30,"2026-10",date(2026,10,9))["drr"]) < 0


def test_migration_seed_and_downgrade_preserve_accounts():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text
    engine=create_engine("sqlite://")
    path=Path(__file__).parents[1]/"migrations/versions/016_commission_policies.py"
    spec=importlib.util.spec_from_file_location("commission_migration",path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)"))
        conn.execute(text("INSERT INTO users(id) VALUES('preserved-account')"))
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
            assert conn.execute(text("SELECT count(*) FROM commission_policies")).scalar() == 4
            module.downgrade()
        assert conn.execute(text("SELECT id FROM users")).scalar() == "preserved-account"
    engine.dispose()


def test_frozen_migration_rates_match_runtime_policy_tables():
    path=Path(__file__).parents[1]/"migrations/versions/016_commission_policies.py"
    spec=importlib.util.spec_from_file_location("commission_migration_tables",path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.POLICIES == SOURCE_POLICIES
