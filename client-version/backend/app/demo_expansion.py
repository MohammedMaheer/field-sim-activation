"""Opt-in, bounded evaluation examples for the current client workflow.

Run ``RELAY_DEMO_EXPANSION=1 python -m app.demo_expansion`` after a backup.
This is additive maintenance, not a reset: existing accounts, assignments,
catalogs, evidence, location settings and historical records are never edited.
New account passwords come only from the deployment's DEMO_PASSWORD setting.
"""
import base64
import hashlib
import json
import os
from datetime import datetime, timedelta
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, select, text

from .db import (DB, Base, Agent, Audit, Branch, CallAttempt, Customer, Document, FieldAsset,
                 FieldAssetMovement, FieldAssetRequest, KycCapture, Movement,
                 NoSaleFeedback, Outlet, Plan, Role, SalesCallTask, SalesRecord,
                 SalesTarget, SavedCaptureDraft, Sim, SimProgress,
                 SupportTicket, User, business_date, now)
from .security import cipher, password_hash


DEMO_ACCOUNTS = {
    "demo.leader.1@relay.demo": "Team Leader",
    "demo.leader.2@relay.demo": "Team Leader",
    "demo.agent.1@relay.demo": "Field Agent",
    "demo.agent.2@relay.demo": "Field Agent",
    "demo.agent.3@relay.demo": "Field Agent",
    "demo.agent.4@relay.demo": "Field Agent",
}
MARKER = "qanawat-evaluation-82"


def sample_id(kind, key):
    return str(uuid5(NAMESPACE_URL, f"{MARKER}/{kind}/{key}"))


def expand_demo(db_factory=DB):
    """Return counts of added rows; repeating a successful run adds nothing."""
    if os.getenv("RELAY_DEMO_EXPANSION") != "1":
        raise RuntimeError("Explicit RELAY_DEMO_EXPANSION=1 is required")
    from .capture_identity import claim_identities, identity_keys
    from .sample_reset import picture
    from .sales_management import (ORDER_TYPES, assigned_manager, change_sale_status,
                                   create_call_tasks)
    from .sr_verification import SrBatch, SrCheck, SrNotice, normal_sr

    added = {}
    with db_factory.begin() as db:
        if db.bind.dialect.name == "postgresql":
            # All invocations share the same transaction-scoped maintenance lock.
            db.execute(text("SELECT pg_advisory_xact_lock(82821013)"))
        elif db.bind.dialect.name == "sqlite":
            db.execute(text("BEGIN IMMEDIATE"))
        before_counts = {table.name: db.scalar(select(func.count()).select_from(table))
                         for table in Base.metadata.sorted_tables}

        def insert(row):
            db.add(row)
            db.flush()
            table = row.__tablename__
            added[table] = added.get(table, 0) + 1
            return row

        admin = db.scalar(select(User).join(Role).where(
            User.email == "admin@relay.demo", Role.name == "Administrator"))
        reviewer = db.scalar(select(User).join(Role).where(
            User.email.like("%@relay.demo"), Role.name == "Compliance Officer"))
        roles = {r.name: r.id for r in db.scalars(select(Role))}
        plans = list(db.scalars(select(Plan).where(Plan.active.is_(True)).order_by(Plan.name)))
        if not admin or not reviewer or not plans or not {"Team Leader", "Field Agent"} <= roles.keys():
            raise RuntimeError("Existing evaluation administrator, reviewer, staff roles and active plan required")

        # Never select a real branch merely because it exists. The branch must
        # already contain a sample sales account and a current sample leader.
        branches = []
        for branch in db.scalars(select(Branch).where(Branch.lifecycle_status == "ACTIVE").order_by(Branch.name, Branch.id)):
            outlet = db.scalar(select(Outlet).join(Agent).join(User, Agent.user_id == User.id).where(
                Outlet.branch_id == branch.id, Agent.employment_status == "ACTIVE",
                User.email.like("%@relay.demo")).order_by(Outlet.name, Outlet.id))
            leader = db.scalar(select(User).where(User.branch_id == branch.id,
                User.role_id == roles["Team Leader"], User.email.like("%@relay.demo")).order_by(User.email))
            if outlet and leader:
                branches.append((branch, outlet, leader))
        branches.sort(key=lambda pair: (0 if "marina" in pair[0].name.casefold() else
                                        1 if "downtown" in pair[0].name.casefold() else 2,
                                        pair[0].name, pair[0].id))
        if len(branches) < 2:
            raise RuntimeError("Two active evaluation branches with current leaders are required; no assignments were changed")
        branches = branches[:2]

        def account(email, name, role_name, branch_id):
            ident = sample_id("user", email)
            person = db.get(User, ident)
            collision = db.scalar(select(User).where(User.email == email))
            if collision and collision.id != ident:
                raise RuntimeError("A reserved evaluation account address is already in use; no existing account was changed")
            if person:
                # Even a deliberately reassigned/renamed example remains intact.
                return person
            secret = os.getenv("DEMO_PASSWORD")
            if not secret:
                raise RuntimeError("DEMO_PASSWORD must be configured to create new evaluation accounts")
            return insert(User(id=ident, email=email, name=name, role_id=roles[role_name],
                               branch_id=branch_id, password_hash=password_hash(secret)))

        agents = []
        names = ["Noah Lane", "Maya Brooks", "Kai Reed", "Leila Quinn"]
        stamp, day = now(), business_date()
        period = day.strftime("%Y-%m")
        for index, (branch, outlet, retained_leader) in enumerate(branches):
            leader = account(f"demo.leader.{index + 1}@relay.demo", ["Emery Ross", "Robin Ellis"][index],
                             "Team Leader", branch.id)
            for offset in range(2):
                slot = index * 2 + offset + 1
                person = account(f"demo.agent.{slot}@relay.demo", names[slot - 1], "Field Agent", branch.id)
                agent = db.get(Agent, sample_id("agent", slot))
                if not agent:
                    # A leader added later never takes over an existing agent.
                    chosen = retained_leader if offset == 0 else leader
                    if chosen.branch_id != branch.id or db.get(Role, chosen.role_id).name != "Team Leader":
                        raise RuntimeError("The example leader assignment changed; review the staff setup before expanding")
                    agent = insert(Agent(id=sample_id("agent", slot), user_id=person.id,
                        employee_id=f"QNW-E{8200 + slot}", outlet_id=outlet.id, leader_id=chosen.id,
                        target=8, status="OFFLINE", employment_status="ACTIVE", assignment_effective_at=stamp,
                        lat=0, lng=0, accuracy=1000000, geofence="NOT RECORDED", last_sync=stamp))
                agents.append(agent)
                for product in ORDER_TYPES:
                    if not db.scalar(select(SalesTarget.id).where(SalesTarget.agent_id == agent.id,
                            SalesTarget.period == period, SalesTarget.order_type == product)):
                        insert(SalesTarget(id=sample_id("target", f"{slot}/{period}/{product}"), agent_id=agent.id,
                            period=period, order_type=product, daily_target=2 if product == "NEW" else 1,
                            monthly_target=40 if product == "NEW" else 20, set_by=admin.id))
                for number, category in enumerate(("Postpaid", "Home Wireless", "Wasel / Prepaid", "Visitor"), 1):
                    ident = sample_id("sim", f"{slot}/{number}")
                    if not db.get(Sim, ident):
                        serial = f"DEMO82-SIM-{slot:02}-{number:02}"
                        sim = insert(Sim(id=ident, serial=serial, iccid=serial,
                            sim_type="eSIM" if number == 1 else "Physical", business_category=category,
                            status="AVAILABLE", agent_id=agent.id, outlet_id=agent.outlet_id, assigned_at=stamp))
                        insert(Movement(id=sample_id("opening", sim.id), sim_id=sim.id, agent_id=agent.id,
                            user_id=admin.id, old_status="WAREHOUSE", new_status="AVAILABLE", reason="Opening evaluation balance"))
                draft_id = sample_id("draft", slot)
                if not db.get(SavedCaptureDraft, draft_id):
                    insert(SavedCaptureDraft(id=draft_id, creator_id=person.id, payload_encrypted=cipher.encrypt(json.dumps({
                        "step": 0, "capture_mode": "SCREENSHOT_SALE", "document_type": "Emirates ID",
                        "name": ["Jamie Rivers", "Alex Parker", "Drew Morgan", "Riley Bell"][slot - 1],
                        "saved_draft_id": draft_id}).encode()).decode()))

        # All product types, the three HW fulfilment choices and the independent
        # backend/SR states are represented without creating carrier/API results.
        scenarios = [
            ("NEW", 0, "SUBMITTED", "IN_PROGRESS", "PENDING_SR_VERIFICATION", ""),
            ("MNP", 1, "VERIFIED", "CLOSED", "MISMATCH", ""),
            ("P2P", 2, "VERIFIED", "CLOSED", "MATCHED", ""),
            ("HW", 3, "VERIFIED", "CLOSED", "MATCHED", "DELIVERY"),
            ("ELIFE", 0, "SUBMITTED", "IN_PROGRESS", "PENDING_SR_VERIFICATION", ""),
            ("WASEL", 1, "VERIFIED", "CANCELLED", "MATCHED", ""),
            ("VISITOR", 2, "REJECTED", "IN_PROGRESS", "MISMATCH", ""),
            ("HW", 2, "VERIFIED", "CLOSED", "MATCHED", "ON_SPOT"),
            ("HW", 0, "SUBMITTED", "IN_PROGRESS", "PENDING_SR_VERIFICATION", "WITHOUT_ROUTER"),
        ]
        entries = {}
        batch_id = sample_id("sr-batch", "current-workflows")
        counts = {"matched": 0, "mismatch": 0, "pending": 0}
        for number, (_, _, _, status, sr_state, _) in enumerate(scenarios, 1):
            counts[{"MATCHED": "matched", "MISMATCH": "mismatch", "PENDING_SR_VERIFICATION": "pending"}[sr_state]] += 1
            if sr_state == "MATCHED":
                sr = f"DEMO-82-SR-{number:03}"
                entries[normal_sr(sr)] = {"sr_number": sr, "request_id": f"DEMO-82-REQ-{number:03}", "status": status, "row_number": len(entries) + 2}
        if not db.get(SrBatch, batch_id):
            insert(SrBatch(id=batch_id, business_date=day.isoformat(), actor_id=reviewer.id,
                fingerprint=hashlib.sha256((MARKER + "/report").encode()).hexdigest(),
                filename=f"Evaluation-SRs-{day.isoformat()}.xlsx", summary=counts,
                report_encrypted=cipher.encrypt(json.dumps(entries).encode()).decode()))
        batch = db.get(SrBatch, batch_id)
        customer_names = ["Rowan Avery", "Ellis Blake", "Reese Morgan", "Finley Hayes", "Quinn Harper",
                          "Skyler Bell", "Arden West", "Parker Drew", "River Emery"]
        for number, (product, agent_index, state, sale_status, sr_state, fulfilment) in enumerate(scenarios, 1):
            sale_id = sample_id("sale", number)
            if db.get(SalesRecord, sale_id):
                continue
            agent = agents[agent_index]
            outlet = db.get(Outlet, agent.outlet_id)
            person = db.get(User, agent.user_id)
            plan = plans[(number - 1) % len(plans)]
            if product in {"WASEL", "VISITOR"}:
                plan = next((p for p in plans if "prepaid" in p.name.casefold()), plan)
            elif product in {"NEW", "MNP", "P2P"}:
                plan = next((p for p in plans if "postpaid" in p.name.casefold()), plan)
            label = {"NEW": "New postpaid", "MNP": "MNP postpaid", "P2P": "Prepaid to postpaid",
                     "HW": "Home Wireless", "ELIFE": "eLife", "WASEL": "Wasel prepaid", "VISITOR": "Visitor"}[product]
            package = label if product in {"HW", "ELIFE"} else plan.name
            reference, sr = f"DEMO-82-REQ-{number:03}", f"DEMO-82-SR-{number:03}"
            name, phone, document_number = customer_names[number - 1], f"05000082{number:02}", f"784-1992-0082{number:03}-1"
            category = {"HW": "Home Wireless", "WASEL": "Wasel / Prepaid", "VISITOR": "Visitor"}.get(product, "Postpaid")
            sim = None if product == "ELIFE" else db.scalar(select(Sim).where(
                Sim.agent_id == agent.id, Sim.business_category == category,
                Sim.status == "AVAILABLE", Sim.serial.like("DEMO82-SIM-%")).order_by(Sim.serial))
            monthly = "" if product in {"HW", "ELIFE"} else str(plan.monthly_cost)
            order_fields = [("Product Name", label), ("Package Name", package), ("MSISDN", phone),
                            ("Request Id", reference), ("SR number", sr), ("Order prepayment", "0")]
            if monthly:
                order_fields.append(("Monthly charge", monthly))
            document = picture("CUSTOMER DETAILS", [("Full name", name), ("Document Type", "UAE Identity card"),
                ("Document Number", document_number), ("Nationality", "United Arab Emirates"),
                ("Date of Birth", "15-Apr-1992"), ("Issue Date", "16-Apr-2021"), ("Expiry Date", "15-Apr-2031"), ("Sex", "Female")])
            order = picture("ORDER DETAILS", order_fields)
            receipt = picture("PAYMENT RECEIPT", [("Request Id", reference), ("SR number", sr)]) if number % 2 == 0 else b""
            batch_day = datetime.fromisoformat(batch.business_date).date()
            day_start = datetime.combine(batch_day, datetime.min.time()) - timedelta(hours=4)
            recorded = datetime.combine(batch_day, datetime.min.time()) + timedelta(hours=6, minutes=number)
            recorded = max(day_start, min(recorded, stamp - timedelta(minutes=number)))
            intake = {"capture_mode": "SCREENSHOT_SALE", "name": name, "document_type": "Emirates ID",
                "document_number": document_number, "nationality": "United Arab Emirates", "birth_date": "1992-04-15",
                "issue_date": "2021-04-16", "expiry_date": "2031-04-15", "gender": "Female",
                "document_image": base64.b64encode(document).decode(), "order_image": base64.b64encode(order).decode(),
                "payment_image": base64.b64encode(receipt).decode() if receipt else "", "order_reference": reference,
                "sr_number": sr, "order_type": product, "product_name": label, "package_name": package,
                "plan_name": plan.name, "plan_id": plan.id, "msisdn": phone, "monthly_cost": monthly,
                "prepayment": "0", "router_fulfilment": fulfilment,
                "router_serial": "DEMO82-ROUTER-ONSPOT" if fulfilment == "ON_SPOT" else "",
                "sim_identifier": sim.serial if sim else "", "sim_type": "ESIM" if sim and sim.sim_type == "eSIM" else "PHYSICAL"}
            data = {"synthetic": True, "evaluation_set": MARKER, "document_kind": "SALE_SCREENSHOTS", "intake": intake,
                "plan_snapshot": {"name": plan.name, "monthly_cost": float(plan.monthly_cost), "promotion": plan.promotion},
                "rows": [{"fields": [{"label": k, "value": v, "source_line": i, "confidence": None} for i, (k, v) in enumerate(order_fields)]}],
                "lines": [{"text": f"{k}: {v}", "confidence": None} for k, v in order_fields],
                "history": [{"action": "Sale recorded", "actor": person.name, "at": recorded.isoformat(), "status": "SUBMITTED"}]}
            if state != "SUBMITTED":
                data["review"] = {"outcome": state, "reviewer": reviewer.name, "at": stamp.isoformat(),
                    "reason": "Customer and order evidence checked" if state == "VERIFIED" else "Please capture a clearer full order screen"}
            capture = insert(KycCapture(id=sample_id("capture", number), agent_id=agent.id,
                branch_id=outlet.branch_id, creator_id=person.id, operation_id=f"evaluation82-{number:03}",
                source_reference=reference, image_hash=hashlib.sha256(order).hexdigest(), image_type="image/png",
                image_encrypted=cipher.encrypt(order).decode(), payload_encrypted=cipher.encrypt(json.dumps(data).encode()).decode(),
                status=state, reviewer_id=reviewer.id if state != "SUBMITTED" else None, created_at=recorded))
            customer = insert(Customer(id=sample_id("customer", number), agent_id=agent.id, name=name,
                mobile=phone, nationality="United Arab Emirates", created_at=recorded))
            sale = insert(SalesRecord(id=sale_id, capture_id=capture.id, agent_id=agent.id, leader_id=agent.leader_id,
                manager_id=assigned_manager(db, outlet.branch_id), branch_id=outlet.branch_id, outlet_id=outlet.id,
                order_type=product, customer_name=name, nationality=customer.nationality, plan_name=package,
                document_encrypted=cipher.encrypt(document_number.encode()).decode(), request_id=reference,
                status="IN_PROGRESS", created_at=recorded,
                details={"customer_id": customer.id, "synthetic": True, "evaluation_set": MARKER,
                    "msisdn": phone, "source_reference": reference, "monthly_cost": monthly, "prepayment": "0",
                    "sr_number": sr, "router_fulfilment": fulfilment, "router_serial": intake["router_serial"],
                    "sim_serial": sim.serial if sim else "", "request_id_on_image": reference,
                    "assignment_effective_at": agent.assignment_effective_at.isoformat() if agent.assignment_effective_at else "",
                    "employee_id": agent.employee_id, "payment_record_status": "RECORDED" if receipt else "NOT_RECORDED"}))
            insert(Document(id=sample_id("document", number), customer_id=customer.id,
                document_type="Emirates ID", encrypted_number=cipher.encrypt(document_number.encode()).decode(), expiry="2031-04-15"))
            claim_identities(db, identity_keys(request_ids=[reference], sr_numbers=[sr],
                             images=[order, receipt]), capture_id=capture.id, sale_id=sale.id)
            create_call_tasks(db, sale)
            db.flush()
            if sale_status in {"CLOSED", "CANCELLED"}:
                for task in db.scalars(select(SalesCallTask).where(SalesCallTask.sale_id == sale.id)):
                    if task.stage == "TELE_VERIFICATION":
                        task.status, task.last_outcome = "COMPLETED", "PASSED"
                change_sale_status(db, sale, "CLOSED", reviewer, None)
                if product in {"NEW", "MNP", "P2P", "HW", "ELIFE"}:
                    insert(CallAttempt(id=sample_id("tele", number), sale_id=sale.id, stage="TELE_VERIFICATION",
                        outcome="PASSED", remark="Customer and order details confirmed", actor_id=reviewer.id))
                if number == 3:
                    welcome = db.scalar(select(SalesCallTask).where(SalesCallTask.sale_id == sale.id, SalesCallTask.stage == "WELCOME_CALL"))
                    welcome.status, welcome.last_outcome = "COMPLETED", "REACHED"
                    insert(CallAttempt(id=sample_id("welcome", number), sale_id=sale.id, stage="WELCOME_CALL",
                        outcome="REACHED", remark="Welcome call completed", actor_id=reviewer.id))
                if sale_status == "CANCELLED":
                    change_sale_status(db, sale, "CANCELLED", reviewer, None)
                    sale.details = {**sale.details, "cancellation_reason": "Cancelled in the daily carrier report"}
            elif number == 9:
                sale.details = {**sale.details, "tele_deferred_until": (business_date(recorded) + timedelta(days=1)).isoformat(),
                    "tele_defer_reason": "Customer line temporarily unavailable", "tele_deferred_by": reviewer.id,
                    "tele_deferred_at": stamp.isoformat()}
            if sim and sale_status == "IN_PROGRESS" and state != "REJECTED":
                insert(SimProgress(id=sample_id("sim-progress", number), sim_id=sim.id, agent_id=agent.id,
                    transaction_id=reference, stage="PENDING_VERIFICATION", payment_status="UPLOADED" if receipt else "NOT_UPLOADED", capture_id=capture.id))
            reason = {"MATCHED": "SR and request ID match the daily report", "MISMATCH": "SR number was not found in the daily report",
                      "PENDING_SR_VERIFICATION": "Daily SR report not checked"}[sr_state]
            insert(SrCheck(id=sample_id("sr-check", number), sale_id=sale.id, batch_id=batch.id,
                          business_date=business_date(recorded).isoformat(), status=sr_state, reason=reason))
            for user_id in {person.id, sale.leader_id} - {None}:
                insert(SrNotice(id=sample_id("sr-notice", f"{number}/{user_id}"), user_id=user_id,
                               sale_id=sale.id, batch_id=batch.id, status=sr_state, reason=reason))

        for index, agent in enumerate(agents):
            outlet = db.get(Outlet, agent.outlet_id)
            ident = sample_id("support", index)
            if not db.get(SupportTicket, ident):
                insert(SupportTicket(id=ident, agent_id=agent.id,
                    subject="Order screen capture" if index % 2 else "Branch SIM stock",
                    message="Please confirm which complete order screen to capture." if index % 2 else "Please allocate additional branch SIM stock.",
                    status="RESOLVED" if index % 2 else "OPEN",
                    response="Capture the full order details screen showing the SR number and request ID." if index % 2 else ""))
            if index not in {0, 2}:
                continue
            ident = sample_id("asset", index)
            if not db.get(FieldAsset, ident):
                asset = insert(FieldAsset(id=ident, category="ROUTER", label="Home Wireless router",
                    serial=f"DEMO82-ROUTER-{index+1:02}", quantity=1, status="AVAILABLE", branch_id=outlet.branch_id,
                    warehouse="Branch store", condition="New", batch=MARKER))
                insert(FieldAssetMovement(id=sample_id("asset-opening", index), asset_id=asset.id,
                    from_branch_id=outlet.branch_id, to_branch_id=outlet.branch_id, actor_id=admin.id,
                    quantity_delta=1, reason="Opening evaluation balance"))
            ident = sample_id("asset-request", index)
            if not db.get(FieldAssetRequest, ident):
                insert(FieldAssetRequest(id=ident, agent_id=agent.id, branch_id=outlet.branch_id,
                    category="ROUTER", quantity=1, reason="Upcoming Home Wireless sale", urgency="NORMAL"))
            ident = sample_id("feedback", index)
            if not db.get(NoSaleFeedback, ident):
                insert(NoSaleFeedback(id=ident, agent_id=agent.id, leader_id=agent.leader_id, branch_id=outlet.branch_id,
                    customer_name=["Harper Vale", "Blake Rowan"][index // 2], product_suggested="Home Wireless",
                    feedback="Customer requested a follow-up next week", rejection_reason="Not ready to purchase"))
        if added:
            insert(Audit(user_id=admin.id, actor=admin.name, role="Administrator", action="Evaluation examples expanded",
                entity=MARKER, reason="Owner requested current examples; existing assignments, records, accounts and catalogs preserved",
                source="Maintenance", new_value={"added": dict(added)}))
        added = {table.name: count - before_counts[table.name] for table in Base.metadata.sorted_tables
                 if (count := db.scalar(select(func.count()).select_from(table))) != before_counts[table.name]}
    return {"added": added, "added_total": sum(added.values()), "preserved_existing": True,
            "location_data_created": False, "emails_queued": 0}


if __name__ == "__main__":
    print(json.dumps(expand_demo(), sort_keys=True))
