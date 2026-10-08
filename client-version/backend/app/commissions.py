"""Approved incentive tables and audited, explicitly configured calculations.

Unknown eligibility inputs are withheld, never treated as earned money. Monthly
results are recomputed from CLOSED sales attributed to their original sale date.
"""
import calendar
import copy
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ConfigDict, Field, model_validator
from sqlalchemy import ForeignKey, Integer, JSON, String, UniqueConstraint, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.exc import IntegrityError

from .db import Agent, Branch, Entity, Role, SalesRecord, User, business_date, get_db, now
from .security import permissions, principal
from .services import audit
from .validation import BusinessInput

router = APIRouter(prefix="/api/commissions", tags=["Commission calculations"])
PP = {"NEW", "MNP", "P2P"}
COMBINED = PP | {"HW", "ELIFE"}
READ_ROLES = {"Administrator", "Operations Manager", "Sales Manager", "Team Leader", "Field Agent"}
WRITERS = {"Administrator", "Operations Manager"}
TL_GATE = {"GATE_1": {"target": 1945, "MNP": "12.5", "NEW": "8", "P2P": "5"},
           "GATE_2": {"target": 2000, "MNP": "15", "NEW": "10", "P2P": "7"}}

# Source tables contain business rates only. Source emails and personal MRC
# profiles remain outside Git; each account receives an explicit configuration.
SOURCE_POLICIES = [
    {"id": "mbo_staff_oct2026", "name": "MBO staff", "family": "MBO_STAFF", "valid_from": "2026-10", "valid_until": None,
     "rules": {"bands": [80, 90, 100, 110], "monthly_rates": {"SLAB_1": ["25", "30", "30", "50"], "SLAB_2": ["50", "60", "75", "90"], "SLAB_3": ["75", "90", "100", "125"]},
               "product_slabs": {"HW": "SLAB_2", "ELIFE": "SLAB_3"}, "cumulative_products": sorted(COMBINED),
               "gate_rates": {"GATE_1": {"MNP": "50", "NEW": "30", "P2P": "25", "slab3_mrc_percent": "5"}, "GATE_2": {"MNP": "60", "NEW": "40", "P2P": "30", "slab3_mrc_percent": "7"}},
               "gate_contract_share_min": 75, "gate_quality_min": 80, "gate_mrc_exclusive_min": 125,
               "source": "MBO Staff Incentive Plan - October,26 - Effective Until Further Notice", "notes": ["HW and eLife each count as one sale", "No average MRC condition for monthly staff incentives", "Gate incentives are additional", "Gate targets must be configured for the kiosk"]}},
    {"id": "postpaid_tl_oct2026", "name": "Postpaid team leader", "family": "POSTPAID_TL", "valid_from": "2026-10", "valid_until": None,
     "rules": {"bands": [90, 100, 110, 120], "monthly_rates": {
         "MNP": {"SLAB_1": ["2.5", "5", "7.5", "10"], "SLAB_2": ["5", "10", "12.5", "15"], "SLAB_3": ["10", "15", "17.5", "20"]},
         "NEW": {"SLAB_1": ["2", "2.5", "5", "7.5"], "SLAB_2": ["5", "7.5", "10", "12.5"], "SLAB_3": ["7.5", "10", "12.5", "15"]},
         "P2P": {"SLAB_1": ["1.5", "2", "2.5", "5"], "SLAB_2": ["2.5", "5", "5", "10"], "SLAB_3": ["5", "10", "10", "12.5"]}},
         "mnp_achievement_min": 70, "contract_share_min": 75, "disconnection_exclusion_threshold": 7,
         "elife_rates": {"2P_299": ["5", "7.5", "10", "15"], "3P_389": ["15", "20", "25", "30"], "3P_NEO_399": ["15", "20", "25", "30"], "3P_429": ["15", "20", "25", "30"], "3P_515": ["20", "25", "30", "40"], "3P_639": ["25", "30", "30", "40"]},
         "elife_postpaid_achievement_min": 80, "mrc_adjustment_percentages": [-20, -10, 0, 10, 20, 30], "gate_rates": TL_GATE, "gate_valid_until": "2026-10",
         "source": "Team Leaders Incentive plan - October,26 - Effective Until Further Notice", "notes": ["Per-sale rates by product and slab", "Individual MRC profiles require explicit configuration", "Gate disconnection exclusion differs from monthly achievement", "Any applicable store incentive split requires explicit configuration"]}},
    {"id": "mbo_tl_oct2026", "name": "MBO team leader", "family": "MBO_TL", "valid_from": "2026-10", "valid_until": None,
     "rules": {"bands": [80, 90, 100, 110], "target": 150, "monthly_rates": ["10", "12.5", "15", "17.5"], "contract_share_min": 80, "full_commission_mrc_min": 185,
               "postpaid_uplifts": [{"mrc_exclusive_min": 200, "percent": 15}, {"mrc_exclusive_min": 220, "percent": 20}], "disconnection_exclusion_threshold": 7, "gate_rates": TL_GATE, "gate_valid_until": "2026-10",
               "source": "MBO Team Leader Incentive Plan – October,26 - Effective Until Further Notice", "notes": ["PP, HW and eLife achievement is cumulative", "Below-185 MRC payment rule requires confirmation", "Above-220 MRC uplift combination requires confirmation"]}},
    {"id": "sm_gate_oct2026", "name": "Sales Manager gates", "family": "SM_GATE", "valid_from": "2026-10", "valid_until": "2026-10",
     "rules": {"gate_rates": {"GATE_1": {"target": 1945, "MNP": "2.5", "NEW": "1.75", "P2P": "0.75"}, "GATE_2": {"target": 2000, "MNP": "3", "NEW": "2.5", "P2P": "1"}},
               "source": "Approved Gate Incentive plan - Oct,26", "notes": ["The source labels both SM rows Gate 1; second target is 2000", "SM allocation and entitlement require confirmation", "Gate attainment must reach 100% without rounding up"]}},
]


class CommissionPolicy(Entity):
    __tablename__ = "commission_policies"
    name: Mapped[str] = mapped_column(String(120))
    family: Mapped[str] = mapped_column(String(30), index=True)
    valid_from: Mapped[str] = mapped_column(String(7))
    valid_until: Mapped[str | None] = mapped_column(String(7), nullable=True)
    rules: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)


class CommissionConfiguration(Entity):
    __tablename__ = "commission_configurations"
    __table_args__ = (UniqueConstraint("user_id", "period", name="uq_commission_user_period"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)
    policy_id: Mapped[str] = mapped_column(ForeignKey("commission_policies.id"))
    inputs: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))


def seed_policies(db):
    for values in SOURCE_POLICIES:
        if not db.get(CommissionPolicy, values["id"]):
            db.add(CommissionPolicy(**copy.deepcopy(values)))
    db.flush()


class CommissionInputs(BusinessInput):
    model_config = ConfigDict(extra="forbid")
    monthly_target: Decimal | None = Field(default=None, gt=0, le=1000000, allow_inf_nan=False)
    mnp_target: Decimal | None = Field(default=None, gt=0, le=1000000, allow_inf_nan=False)
    contract_share_percent: Decimal | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    quality_percent: Decimal | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    disconnection_percent: Decimal | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    metric_definition: str = Field(default="", max_length=1000)
    plan_slabs: dict[str, Literal["SLAB_1", "SLAB_2", "SLAB_3"]] = Field(default_factory=dict, max_length=1000)
    elife_plan_codes: dict[str, Literal["2P_299", "3P_389", "3P_NEO_399", "3P_429", "3P_515", "3P_639"]] = Field(default_factory=dict, max_length=1000)
    elife_target: Decimal | None = Field(default=None, gt=0, le=1000000, allow_inf_nan=False)
    elife_attainment_basis: Literal["POSTPAID", "ELIFE"] | None = None
    mrc_thresholds: list[Decimal] = Field(default_factory=list, max_length=6)
    mrc_eligibility_floor: Decimal | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)
    mbo_below185_multiplier: Decimal | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    mbo_uplift_mode: Literal["HIGHER_ONLY", "CUMULATIVE"] | None = None
    disconnected_sale_ids: list[str] = Field(default_factory=list, max_length=10000)
    disconnected_sales_confirmed: bool = False
    gate_enabled: bool | None = None
    gate_scope_branch_ids: list[str] = Field(default_factory=list, max_length=1000)
    staff_gate_targets: list[Decimal] = Field(default_factory=list, max_length=2)
    gate_mode: Literal["HIGHEST_ONLY", "ADDITIVE"] | None = None
    gate_entitlement_confirmed: bool | None = None
    gate_allocation: Literal["CONTRIBUTION", "OWN_SALES"] | None = None
    gate_disconnection_mode: Literal["INCLUDE", "EXCLUDE"] | None = None
    gate_disconnected_sale_ids: list[str] = Field(default_factory=list, max_length=10000)
    payout_share_percent: Decimal | None = Field(default=None, gt=0, le=100, allow_inf_nan=False)
    payout_share_confirmed: bool = False
    staff_bands_confirmed: bool = False

    @model_validator(mode="after")
    def consistent_inputs(self):
        for key in ("mrc_thresholds", "staff_gate_targets"):
            values = getattr(self, key)
            if any(not item.is_finite() or item < 0 or item > 1000000 for item in values):
                raise ValueError(f"{key} must contain finite non-negative values")
            if values and (len(values) != (6 if key == "mrc_thresholds" else 2) or any(a >= b for a, b in zip(values, values[1:]))):
                raise ValueError(f"{key} must contain ordered thresholds")
        for mappings in (self.plan_slabs, self.elife_plan_codes):
            if any(not key.strip() or len(key) > 160 for key in mappings):
                raise ValueError("Plan mappings need a valid plan name")
            if len({key.strip().casefold() for key in mappings}) != len(mappings):
                raise ValueError("Plan mappings must not contain duplicate plan names")
        if any(len(set(values)) != len(values) for values in (self.gate_scope_branch_ids, self.disconnected_sale_ids, self.gate_disconnected_sale_ids)):
            raise ValueError("Scope and sale lists must not contain duplicates")
        if any(len(value) > 36 for value in self.gate_scope_branch_ids + self.disconnected_sale_ids + self.gate_disconnected_sale_ids):
            raise ValueError("Use valid branch and sale identifiers")
        return self


class ConfigurationWrite(BusinessInput):
    model_config = ConfigDict(extra="forbid")
    policy_id: str = Field(min_length=1, max_length=36)
    version: int = Field(ge=0)
    inputs: CommissionInputs
    reason: str = Field(min_length=5, max_length=300)


def role_name(db, user):
    role = db.get(Role, user.role_id)
    return role.name if role else ""


def readable(db, user):
    if role_name(db, user) not in READ_ROLES or "read" not in permissions(db, user):
        raise HTTPException(403, "Your role cannot view commission calculations")


def allowed_subjects(db, user):
    readable(db, user)
    role = role_name(db, user)
    query = select(User).join(Role).where(Role.name.in_({"Field Agent", "Team Leader", "Sales Manager"}))
    if role == "Field Agent":
        query = query.where(User.id == user.id)
    elif role == "Team Leader":
        # A leader's own snapshot-based aggregate does not expose another
        # employee's earnings across unrelated historical assignments.
        query = query.where(User.id == user.id)
    return list(db.scalars(query.order_by(User.name)))


def subject_for(db, user, user_id):
    subject = next((row for row in allowed_subjects(db, user) if row.id == user_id), None)
    if not subject:
        raise HTTPException(404, "Commission account not found")
    return subject


def period_bounds(period):
    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", period):
        raise HTTPException(422, "Period must use YYYY-MM")
    year, month = map(int, period.split("-"))
    dubai = ZoneInfo("Asia/Dubai")
    start = datetime(year, month, 1, tzinfo=dubai).astimezone(timezone.utc).replace(tzinfo=None)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=dubai).astimezone(timezone.utc).replace(tzinfo=None)
    return start, end


def subject_sales(db, subject, start, end):
    query = select(SalesRecord).where(SalesRecord.created_at >= start, SalesRecord.created_at < end)
    role = role_name(db, subject)
    if role == "Field Agent":
        query = query.where(SalesRecord.agent_id.in_(select(Agent.id).where(Agent.user_id == subject.id)))
    elif role == "Team Leader":
        query = query.where(SalesRecord.leader_id == subject.id)
    elif role == "Sales Manager":
        query = query.where(SalesRecord.manager_id == subject.id)
    else:
        return []
    return list(db.scalars(query))


def money(value):
    return format(Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f")


def number(value):
    if value is None:
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return result if result.is_finite() else None


def sale_mrc(row):
    # Captured charge only: do not infer missing MRC from an edited plan price.
    raw = str((row.details or {}).get("monthly_cost", "")).strip()
    match = re.fullmatch(r"(?:AED\s*)?(\d+(?:\.\d{1,2})?)(?:\s*(?:AED|/\s*(?:mo|month)|monthly))?", raw, re.I)
    return number(match.group(1)) if match else None


def component(name, amount=None, missing=(), reason="", details=None):
    return {"name": name, "status": "CONFIGURATION_REQUIRED" if missing else "NOT_ELIGIBLE" if reason else "CALCULATED",
            "amount": money(amount) if amount is not None and not missing else None,
            "missing_inputs": list(dict.fromkeys(missing)), "reason": reason, "details": details or {}}


def rate_band(percent, bands):
    return next((index for index in range(len(bands) - 1, -1, -1) if percent >= bands[index]), None)


def metric_inputs(inputs, required):
    missing = [key for key in required if inputs.get(key) is None]
    if required and not inputs.get("metric_definition"):
        missing.append("metric_definition")
    return missing


def monthly_component(policy, inputs, sales):
    rules, family = policy.rules, policy.family
    if family == "SM_GATE":
        return []
    combined = [row for row in sales if row.order_type in COMBINED]
    pp = [row for row in combined if row.order_type in PP]
    missing = []
    if family == "MBO_STAFF":
        missing += ["monthly_target"] if inputs.get("monthly_target") is None else []
        missing += ["staff_bands_confirmed"] if not inputs.get("staff_bands_confirmed") else []
        target = number(inputs.get("monthly_target"))
    else:
        missing += metric_inputs(inputs, ["contract_share_percent", "disconnection_percent"])
        target = Decimal(rules["target"]) if family == "MBO_TL" else number(inputs.get("monthly_target"))
        if not target:
            missing.append("monthly_target")
        if family == "POSTPAID_TL" and not inputs.get("mnp_target"):
            missing.append("mnp_target")
    # Disconnection treatment is explicit and independent of cancellations.
    disconnected = set(inputs.get("disconnected_sale_ids", []))
    if number(inputs.get("disconnection_percent")) is not None and number(inputs["disconnection_percent"]) > Decimal("7"):
        if not inputs.get("disconnected_sales_confirmed"):
            missing.append("disconnected_sales_confirmed")
        combined = [row for row in combined if row.id not in disconnected]
        pp = [row for row in pp if row.id not in disconnected]
    achievement = Decimal(len(combined if family != "POSTPAID_TL" else pp)) * 100 / target if target else None
    info = {"eligible_sales": len(combined if family != "POSTPAID_TL" else pp), "target": str(target) if target else None,
            "achievement_percent": str(achievement) if achievement is not None else None, "line_items": []}
    def finished(item):
        extra = []
        if family == "POSTPAID_TL":
            extra = [elife_component(policy, inputs, combined, achievement)] if achievement is not None else [component("eLife incentive", missing=["monthly_target"])]
        return [item, *extra]
    if missing:
        return finished(component("Monthly incentive", missing=missing, details=info))
    band = rate_band(achievement, rules["bands"])
    if band is None:
        return finished(component("Monthly incentive", Decimal(0), reason="Target achievement is below the first approved rate band", details=info))
    if family != "MBO_STAFF" and number(inputs["contract_share_percent"]) < Decimal(rules["contract_share_min"]):
        return finished(component("Monthly incentive", Decimal(0), reason="Contract share does not meet the approved minimum", details=info))
    if family == "POSTPAID_TL":
        mnp_percent = Decimal(sum(row.order_type == "MNP" for row in pp)) * 100 / number(inputs["mnp_target"])
        info["mnp_achievement_percent"] = str(mnp_percent)
        if mnp_percent < Decimal(rules["mnp_achievement_min"]):
            return finished(component("Monthly incentive", Decimal(0), reason="MNP target achievement is below 70%", details=info))
    slabs = {key.strip().casefold(): value for key, value in inputs.get("plan_slabs", {}).items()}
    groups, total, pp_total = {}, Decimal(0), Decimal(0)
    for row in combined if family != "POSTPAID_TL" else pp:
        if family == "MBO_TL":
            slab = "COMBINED"
            rate = Decimal(rules["monthly_rates"][band])
        else:
            slab = rules.get("product_slabs", {}).get(row.order_type) or slabs.get(row.plan_name.strip().casefold())
            if not slab:
                missing.append("plan_slabs:" + row.plan_name)
                continue
            rate = Decimal(rules["monthly_rates"][slab][band] if family == "MBO_STAFF" else rules["monthly_rates"][row.order_type][slab][band])
        key = (row.order_type, slab, str(rate))
        groups[key] = groups.get(key, 0) + 1
        total += rate
        if row.order_type in PP:
            pp_total += rate
    info["line_items"] = [{"product": key[0], "slab": key[1], "rate": money(key[2]), "sales": count, "amount": money(Decimal(key[2]) * count)} for key, count in sorted(groups.items())]
    if family != "MBO_STAFF" and pp:
        mrc_values = [sale_mrc(row) for row in pp]
        if any(value is None for value in mrc_values):
            missing.append("captured_monthly_charge")
        else:
            avg = sum(mrc_values) / len(mrc_values)
            info["average_postpaid_mrc"] = str(avg)
            if family == "MBO_TL":
                if avg < Decimal("185"):
                    multiplier = number(inputs.get("mbo_below185_multiplier"))
                    if multiplier is None:
                        missing.append("mbo_below185_multiplier")
                    else:
                        total *= multiplier
                        pp_total *= multiplier
                        info["below185_multiplier"] = str(multiplier)
                elif avg > Decimal("200"):
                    uplift = Decimal("15")
                    if avg > Decimal("220"):
                        if not inputs.get("mbo_uplift_mode"):
                            missing.append("mbo_uplift_mode")
                        uplift = Decimal("35" if inputs.get("mbo_uplift_mode") == "CUMULATIVE" else "20")
                    total += pp_total * uplift / 100
                    info["postpaid_uplift_percent"] = str(uplift)
            else:
                thresholds = [number(value) for value in inputs.get("mrc_thresholds", [])]
                floor = number(inputs.get("mrc_eligibility_floor"))
                if len(thresholds) != 6 or floor is None:
                    missing += ["mrc_thresholds", "mrc_eligibility_floor"]
                elif avg < floor:
                    total = Decimal(0)
                    info["mrc_ineligible"] = True
                else:
                    adjustment_band = rate_band(avg, thresholds)
                    if adjustment_band is None:
                        missing.append("mrc_band_below_first_threshold")
                    else:
                        adjustment = Decimal(rules["mrc_adjustment_percentages"][adjustment_band])
                        total *= 1 + adjustment / 100
                        info["mrc_adjustment_percent"] = str(adjustment)
    return finished(component("Monthly incentive", total, missing=missing, details=info))


def elife_component(policy, inputs, sales, pp_achievement):
    elife = [row for row in sales if row.order_type == "ELIFE"]
    if not elife:
        return component("eLife incentive", Decimal(0), details={"eligible_sales": 0})
    if pp_achievement < Decimal("80"):
        return component("eLife incentive", Decimal(0), reason="Postpaid target achievement is below 80%")
    basis = inputs.get("elife_attainment_basis")
    missing = [] if basis else ["elife_attainment_basis"]
    attainment = pp_achievement
    if basis == "ELIFE":
        target = number(inputs.get("elife_target"))
        if not target:
            missing.append("elife_target")
        else:
            attainment = Decimal(len(elife)) * 100 / target
    band = rate_band(attainment, policy.rules["bands"])
    if band is None:
        missing.append("elife_rate_below90_rule")
    mapping = {key.casefold().strip(): value for key, value in inputs.get("elife_plan_codes", {}).items()}
    total, lines = Decimal(0), []
    for row in elife:
        code = mapping.get(row.plan_name.casefold().strip())
        if not code:
            missing.append("elife_plan_codes:" + row.plan_name)
        elif band is not None:
            rate = Decimal(policy.rules["elife_rates"][code][band])
            total += rate
            lines.append({"plan_code": code, "rate": money(rate)})
    return component("eLife incentive", total, missing=missing, details={"eligible_sales": len(elife), "line_items": lines})


def gate_component(db, policy, inputs, own_sales, start, end, period):
    if inputs.get("gate_enabled") is False:
        return {**component("Gate incentive", Decimal(0)), "status": "NOT_APPLICABLE", "reason": "Gate incentive is disabled in this account configuration"}
    if policy.rules.get("gate_valid_until") and period > policy.rules["gate_valid_until"]:
        return component("Gate incentive", missing=["gate_policy_for_period"])
    required = ["contract_share_percent"] + (["quality_percent"] if policy.family == "MBO_STAFF" else [])
    missing = metric_inputs(inputs, required)
    if inputs.get("gate_enabled") is None:
        missing.append("gate_enabled")
    if not inputs.get("gate_scope_branch_ids"):
        missing.append("gate_scope_branch_ids")
    if not inputs.get("gate_mode"):
        missing.append("gate_mode")
    if policy.family == "MBO_STAFF" and len(inputs.get("staff_gate_targets", [])) != 2:
        missing.append("staff_gate_targets")
    if policy.family != "MBO_STAFF":
        if not inputs.get("gate_entitlement_confirmed"):
            missing.append("gate_entitlement_confirmed")
        if not inputs.get("gate_allocation"):
            missing.append("gate_allocation")
        if policy.family == "MBO_TL" and number(inputs.get("disconnection_percent")) is not None and number(inputs["disconnection_percent"]) > Decimal("7") and not inputs.get("gate_disconnection_mode"):
            missing.append("gate_disconnection_mode")
    if missing:
        return component("Gate incentive", missing=missing)
    if number(inputs["contract_share_percent"]) < Decimal("75"):
        return component("Gate incentive", Decimal(0), reason="Gate contract share is below 75%")
    if policy.family == "MBO_STAFF" and number(inputs["quality_percent"]) < Decimal("80"):
        return component("Gate incentive", Decimal(0), reason="100% gate clawback applies because quality is below 80%")
    scope = list(db.scalars(select(SalesRecord).where(SalesRecord.status == "CLOSED", SalesRecord.order_type.in_(PP), SalesRecord.branch_id.in_(inputs["gate_scope_branch_ids"]), SalesRecord.created_at >= start, SalesRecord.created_at < end)))
    if policy.family == "MBO_TL" and inputs.get("gate_disconnection_mode") == "EXCLUDE":
        excluded = set(inputs.get("gate_disconnected_sale_ids", []))
        scope = [row for row in scope if row.id not in excluded]
    if any(sale_mrc(row) is None for row in scope):
        return component("Gate incentive", missing=["gate_captured_monthly_charge"])
    qualifying = [row for row in scope if sale_mrc(row) > Decimal("125")]
    own_ids = {row.id for row in own_sales}
    own = [row for row in qualifying if row.id in own_ids]
    rates = policy.rules["gate_rates"]
    targets = inputs["staff_gate_targets"] if policy.family == "MBO_STAFF" else [rates["GATE_1"]["target"], rates["GATE_2"]["target"]]
    achieved = [key for key, target in zip(("GATE_1", "GATE_2"), targets) if Decimal(len(qualifying)) >= number(target)]
    if inputs["gate_mode"] == "HIGHEST_ONLY" and achieved:
        achieved = achieved[-1:]
    total = Decimal(0)
    slabs = {key.strip().casefold(): value for key, value in inputs.get("plan_slabs", {}).items()}
    for gate in achieved:
        applicable = own if policy.family == "MBO_STAFF" or inputs.get("gate_allocation") == "OWN_SALES" else qualifying
        subtotal = sum((Decimal(rates[gate][row.order_type]) for row in applicable), Decimal(0))
        if policy.family == "MBO_STAFF":
            for row in own:
                slab = slabs.get(row.plan_name.strip().casefold())
                if not slab:
                    missing.append("plan_slabs:" + row.plan_name)
                elif slab == "SLAB_3":
                    subtotal += sale_mrc(row) * Decimal(rates[gate]["slab3_mrc_percent"]) / 100
        elif inputs.get("gate_allocation") == "CONTRIBUTION":
            subtotal *= Decimal(len(own)) / len(qualifying) if qualifying else Decimal(0)
        total += subtotal
    return component("Gate incentive", total, missing=missing, details={"aggregate_qualifying_sales": len(qualifying), "own_qualifying_sales": len(own), "achieved_gates": achieved, "mode": inputs["gate_mode"]})


def configuration_view(row):
    return {"id": row.id, "user_id": row.user_id, "period": row.period, "policy_id": row.policy_id,
            "inputs": row.inputs, "version": row.version} if row else None


@router.get("/policies")
def policies(user=Depends(principal), db=Depends(get_db)):
    readable(db, user)
    return [{"id": row.id, "name": row.name, "family": row.family, "valid_from": row.valid_from, "valid_until": row.valid_until,
             "rules": row.rules, "version": row.version} for row in db.scalars(select(CommissionPolicy).order_by(CommissionPolicy.name))]


@router.get("/subjects")
def subjects(user=Depends(principal), db=Depends(get_db)):
    return [{"id": row.id, "name": row.name, "role": role_name(db, row), "branch_id": row.branch_id} for row in allowed_subjects(db, user)]


@router.get("/configurations")
def configurations(period: str, user=Depends(principal), db=Depends(get_db)):
    period_bounds(period)
    ids = [row.id for row in allowed_subjects(db, user)]
    return [configuration_view(row) for row in db.scalars(select(CommissionConfiguration).where(CommissionConfiguration.period == period, CommissionConfiguration.user_id.in_(ids)))]


@router.put("/configurations/{user_id}/{period}")
def write_configuration(user_id: str, period: str, body: ConfigurationWrite, request: Request, user=Depends(principal), db=Depends(get_db)):
    if role_name(db, user) not in WRITERS or "incentive.write" not in permissions(db, user):
        raise HTTPException(403, "Only authorized backend management can configure incentives")
    start, end = period_bounds(period)
    subject = subject_for(db, user, user_id)
    policy = db.get(CommissionPolicy, body.policy_id)
    if not policy or period < policy.valid_from or (policy.valid_until and period > policy.valid_until):
        raise HTTPException(422, "Choose an incentive policy valid for this period")
    expected = {"Field Agent": {"MBO_STAFF"}, "Team Leader": {"POSTPAID_TL", "MBO_TL"}, "Sales Manager": {"SM_GATE"}}
    if policy.family not in expected.get(role_name(db, subject), set()):
        raise HTTPException(422, "This incentive policy does not apply to the selected role")
    inputs = body.inputs.model_dump(mode="json")
    for branch_id in inputs["gate_scope_branch_ids"]:
        if not db.get(Branch, branch_id):
            raise HTTPException(422, "Gate scope contains an unknown branch")
    sale_ids = {row.id for row in subject_sales(db, subject, start, end)}
    if not set(inputs["disconnected_sale_ids"]).issubset(sale_ids):
        raise HTTPException(422, "Disconnected sales must belong to this account and period")
    gate_sale_ids = set(db.scalars(select(SalesRecord.id).where(SalesRecord.branch_id.in_(inputs["gate_scope_branch_ids"]), SalesRecord.created_at >= start, SalesRecord.created_at < end)))
    if not set(inputs["gate_disconnected_sale_ids"]).issubset(gate_sale_ids):
        raise HTTPException(422, "Gate disconnections must belong to the configured branches and period")
    row = db.scalar(select(CommissionConfiguration).where(CommissionConfiguration.user_id == subject.id, CommissionConfiguration.period == period).with_for_update())
    if body.version != (row.version if row else 0):
        raise HTTPException(409, "Incentive configuration changed. Refresh and try again.")
    old = configuration_view(row)
    if row:
        row.policy_id, row.inputs, row.updated_by = policy.id, inputs, user.id
        row.version += 1
    else:
        row = CommissionConfiguration(user_id=subject.id, period=period, policy_id=policy.id, inputs=inputs, updated_by=user.id)
        db.add(row)
    try:
        db.flush()
        audit(db, user, "Commission Configuration Updated", row.id, old=old, new=configuration_view(row), reason=body.reason, request=request)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Incentive configuration changed. Refresh and try again.") from None
    return configuration_view(row)


@router.get("/summary")
def summary(period: str = "", user_id: str = "", user=Depends(principal), db=Depends(get_db)):
    period = period or business_date().strftime("%Y-%m")
    start, end = period_bounds(period)
    people = [subject_for(db, user, user_id)] if user_id else allowed_subjects(db, user)
    output = []
    for subject in people:
        rows = subject_sales(db, subject, start, end)
        closed = [row for row in rows if row.status == "CLOSED"]
        cfg = db.scalar(select(CommissionConfiguration).where(CommissionConfiguration.user_id == subject.id, CommissionConfiguration.period == period))
        policy = db.get(CommissionPolicy, cfg.policy_id) if cfg else None
        if not cfg or not policy:
            components = [component("Incentive", missing=["policy_assignment"])]
        elif period < policy.valid_from or (policy.valid_until and period > policy.valid_until):
            components = [component("Incentive", missing=["policy_for_period"])]
        else:
            components = monthly_component(policy, cfg.inputs, closed)
            components.append(gate_component(db, policy, cfg.inputs, closed, start, end, period))
            if not cfg.inputs.get("payout_share_confirmed"):
                components.append(component("Payout allocation", missing=["payout_share_confirmed"]))
            elif cfg.inputs.get("payout_share_percent") is None:
                components.append(component("Payout allocation", missing=["payout_share_percent"]))
        missing = list(dict.fromkeys(value for item in components for value in item["missing_inputs"]))
        amount = sum((Decimal(item["amount"]) for item in components if item["amount"] is not None), Decimal(0))
        if cfg and cfg.inputs.get("payout_share_percent") is not None:
            amount *= number(cfg.inputs["payout_share_percent"]) / 100
        output.append({"user_id": subject.id, "name": subject.name, "role": role_name(db, subject), "period": period,
                       "policy_id": policy.id if policy else None, "policy_name": policy.name if policy else "Not configured",
                       "net_sales": len(closed), "cancelled": sum(row.status == "CANCELLED" for row in rows),
                       "in_progress": sum(row.status == "IN_PROGRESS" for row in rows), "status": "CONFIGURATION_REQUIRED" if missing else "CALCULATED",
                       "amount": None if missing else money(amount), "currency": "AED", "missing_inputs": missing, "components": components,
                       "configuration": configuration_view(cfg)})
    return {"period": period, "recomputed_at": now().isoformat(), "rows": output, "can_configure": role_name(db, user) in WRITERS and "incentive.write" in permissions(db, user),
            "method": "Net closed sales, attributed to their original sale date; cancelled records are excluded"}


def run_rates(net_sales, target, period, on_date=None):
    """Client-approved CRR and DRR; projection remains unconfigured."""
    period_bounds(period)
    year, month = map(int, period.split("-"))
    current = on_date or business_date()
    days_in_month = calendar.monthrange(year, month)[1]
    days_gone = 0 if (current.year, current.month) < (year, month) else days_in_month if (current.year, current.month) > (year, month) else current.day
    remaining = days_in_month - days_gone
    return {"days_gone": days_gone, "days_remaining": remaining,
            "crr": str(Decimal(net_sales) / days_gone) if days_gone else None,
            "drr": str((Decimal(target) - Decimal(net_sales)) / remaining) if remaining and target is not None else None,
            "projection": None, "projection_status": "FORMULA_REQUIRED"}
