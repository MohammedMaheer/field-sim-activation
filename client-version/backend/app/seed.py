import os
import random
from datetime import timedelta
from sqlalchemy import select
from .db import *
from .security import password_hash, cipher

ROLE_PERMISSIONS = {
    "Field Agent": ["read", "ekyc.write", "shift.write", "inventory.self"],
    "Team Leader": [
        "read",
        "task.write",
        "support.write",
        "ekyc.write",
        "report.read",
        "audit.read",
        "device.ping",
    ],
    "Branch Manager": [
        "read",
        "task.write",
        "support.write",
        "ekyc.write",
        "report.read",
        "audit.read",
        "device.ping",
    ],
    "Operations Manager": [
        "read",
        "task.write",
        "incentive.write",
        "inventory.write",
        "support.write",
        "ekyc.write",
        "report.read",
        "audit.read",
        "device.ping",
        "compliance.write",
    ],
    "Compliance Officer": ["read", "report.read", "audit.read", "compliance.write"],
    "Inventory Manager": ["read", "report.read", "audit.read", "inventory.write"],
    "Administrator": [
        "read",
        "task.write",
        "incentive.write",
        "inventory.write",
        "support.write",
        "ekyc.write",
        "report.read",
        "audit.read",
        "device.ping",
        "compliance.write",
        "shift.write",
    ],
}


def seed():
    random.seed(48)
    with DB() as db:
        if db.scalar(select(User.id).limit(1)):
            return
        roles = {}
        for name, perms in ROLE_PERMISSIONS.items():
            role = Role(name=name)
            db.add(role)
            db.flush()
            roles[name] = role
            for p in perms:
                db.add(Permission(role_id=role.id, name=p))
        branches = [Branch(name=n) for n in ["Dubai Central", "Abu Dhabi Region"]]
        db.add_all(branches)
        db.flush()
        pw = password_hash(os.getenv("DEMO_PASSWORD", "RelayDemo!2026"))
        users = []
        for email, name, role in [
            ("admin", "Alex Morgan", "Administrator"),
            ("ops", "Sam Taylor", "Operations Manager"),
            ("leader", "Rayan Vale", "Team Leader"),
            ("leader2", "Mira Rowan", "Team Leader"),
            ("cluster", "Ari Quinn", "Branch Manager"),
            ("compliance", "Noor Avery", "Compliance Officer"),
            ("inventory", "Dara Lane", "Inventory Manager"),
        ]:
            u = User(
                email=f"{email}@relay.demo",
                name=name,
                password_hash=pw,
                role_id=roles[role].id,
                branch_id=branches[0 if email != "leader2" else 1].id,
            )
            db.add(u)
            users.append(u)
        db.flush()
        outlets = []
        for i, (name, area, lat, lng) in enumerate(
            [
                ("Marina Walk", "Dubai Marina", 25.080, 55.141),
                ("Downtown Hub", "Downtown Dubai", 25.197, 55.279),
                ("Creek Point", "Dubai Creek", 25.231, 55.332),
                ("Yas Central", "Yas Island", 24.488, 54.607),
            ]
        ):
            o = Outlet(
                name=name, area=area, lat=lat, lng=lng, branch_id=branches[1 if i == 3 else 0].id
            )
            db.add(o)
            db.flush()
            outlets.append(o)
            db.add(Territory(name=f"{name} territory", outlet_id=o.id, radius=500))
        product = Product(name="Relay Mobile")
        db.add(product)
        db.flush()
        plans = [
            Plan(product_id=product.id, name=n, monthly_cost=p, data_gb=g, promotion=pr)
            for n, p, g, pr in [
                ("Essential 125", 125, 15, "First month data boost"),
                ("Everyday 200", 200, 40, "Free SIM delivery"),
                ("Unlimited 350", 350, 250, "5 GB roaming included"),
            ]
        ]
        db.add_all(plans)
        db.flush()
        names = [
            "Zayn Mercer",
            "Leila Arden",
            "Omar Ellis",
            "Hana Wells",
            "Adam Rowan",
            "Sara Vale",
            "Ilyas Reed",
            "Nadia Brooks",
            "Sami Blake",
            "Lina Hart",
            "Rami Stone",
            "Maya Quinn",
        ]
        for i, name in enumerate(names):
            outlet = outlets[i % 4]
            user = User(
                name=name,
                email=f"agent{i + 1}@relay.demo",
                password_hash=pw,
                role_id=roles["Field Agent"].id,
                branch_id=outlet.branch_id,
            )
            db.add(user)
            db.flush()
            agent = Agent(
                user_id=user.id,
                employee_id=f"RLY-{1041 + i}",
                leader_id=users[3 if i % 4 == 3 else 2].id,
                outlet_id=outlet.id,
                target=20,
                status="OFFLINE" if i == 7 else "ON BREAK" if i == 5 else "ACTIVE",
                lat=outlet.lat + (0.009 if i == 2 else 0.0043 if i == 5 else (i % 3) * 0.0003),
                lng=outlet.lng + 0.0003,
                geofence="OUT OF BOUNDS" if i == 2 else "NEAR BOUNDARY" if i == 5 else "IN BOUNDS",
                last_sync=now() - timedelta(minutes=42 if i == 7 else i),
            )
            db.add(agent)
            db.flush()
            db.add(
                FieldTask(
                    agent_id=agent.id,
                    title="Review today's KYC queue",
                    note="Check captured transactions and follow up on pending review.",
                    due_date=business_date().isoformat(),
                )
            )
            db.add(
                FieldTask(
                    agent_id=agent.id,
                    title="Confirm assigned SIM stock",
                    note="Reconcile available stock before the shift ends.",
                    due_date=business_date().isoformat(),
                )
            )
            db.add(
                Incentive(
                    agent_id=agent.id,
                    period=business_date().strftime("%Y-%m"),
                    amount=125 + i * 15,
                    note="Synthetic monthly incentive example",
                    source="DEMO",
                )
            )
            if i != 7:
                db.add(Shift(agent_id=agent.id, created_at=now().replace(hour=4, minute=0)))
            for s in range(3 if i == 4 else 18):
                sim = Sim(
                    iccid=f"DEMO-ICCID-{i:02}-{s:04}",
                    serial=f"DEMO-SIM-{i:02}-{s:04}",
                    sim_type="eSIM" if s % 3 == 0 else "Physical",
                    agent_id=agent.id,
                    outlet_id=outlet.id,
                    assigned_at=now(),
                )
                db.add(sim)
                db.flush()
                db.add(
                    Movement(
                        sim_id=sim.id,
                        agent_id=agent.id,
                        user_id=users[0].id,
                        old_status="WAREHOUSE",
                        new_status="AVAILABLE",
                        reason="Synthetic opening allocation",
                    )
                )
            for j in range(24 if i < 3 else 14):
                t = now() - timedelta(
                    days=0 if j < 12 else random.randint(1, 6), minutes=random.randint(2, 360)
                )
                customer = Customer(
                    agent_id=agent.id,
                    name=f"{['Avery', 'Jordan', 'Casey', 'Morgan', 'Riley'][j % 5]} Demo {i + 1:02}{j + 1:02}",
                    mobile=f"DEMO-MSISDN-{i:02}{j:03}",
                    nationality="Synthetic UAE resident",
                )
                db.add(customer)
                db.flush()
                db.add(
                    Document(
                        customer_id=customer.id,
                        document_type="National Identity Card",
                        encrypted_number=cipher.encrypt(f"DEMO-ID-{i}-{j}".encode()).decode(),
                        expiry="2030-12-31",
                    )
                )
                status = (
                    "FAILED"
                    if j == 3 and i % 4 == 0
                    else "MANUAL REVIEW"
                    if j == 4 and i % 5 == 0
                    else "VERIFIED"
                )
                e = Ekyc(
                    agent_id=agent.id,
                    customer_id=customer.id,
                    status=status,
                    confidence=98.8 + random.random() if status == "VERIFIED" else 72.1,
                    result={
                        "provider": "MOCK",
                        "liveness": status == "VERIFIED",
                        "face_match": status == "VERIFIED",
                    },
                    created_at=t,
                )
                db.add(e)
                db.flush()
                state = (
                    "FAILED"
                    if status == "FAILED"
                    else "DRAFT"
                    if status == "MANUAL REVIEW"
                    else "PROCESSING"
                    if j == 0
                    else "ACTIVATED"
                )
                sim = Sim(
                    iccid=f"DEMO-USED-{i}-{j}",
                    serial=f"DEMO-USED-SERIAL-{i}-{j}",
                    sim_type="Physical",
                    status="RESERVED"
                    if state == "PROCESSING"
                    else "ACTIVATED"
                    if state == "ACTIVATED"
                    else "BLOCKED",
                    agent_id=agent.id,
                    outlet_id=outlet.id,
                )
                db.add(sim)
                db.flush()
                o = Order(
                    reference=f"RLY-{260900 + i * 100 + j}",
                    request_id=f"REQ-{260900 + i * 100 + j}",
                    sr_id=f"SR-{260900 + i * 100 + j}",
                    msisdn=customer.mobile,
                    agent_id=agent.id,
                    customer_id=customer.id,
                    plan_id=plans[j % 3].id,
                    sim_id=sim.id,
                    ekyc_id=e.id,
                    status=state,
                    operation_id=f"seed-{i}-{j}",
                    created_at=t,
                    updated_at=now(),
                    handling_seconds=random.randint(150, 360),
                    draft={},
                )
                db.add(o)
                db.flush()
                for step in ["Created", "eKYC " + status.lower(), "SIM assigned", state.title()]:
                    db.add(OrderEvent(order_id=o.id, actor=user.name, action=step, created_at=t))
                if state == "ACTIVATED":
                    db.add(
                        Activation(
                            order_id=o.id,
                            provider_reference=f"MOCK-{o.id[:8]}",
                            status=state,
                            created_at=t,
                        )
                    )
                db.add(
                    Movement(
                        sim_id=sim.id,
                        agent_id=agent.id,
                        user_id=user.id,
                        old_status="AVAILABLE",
                        new_status=sim.status,
                        reason="Synthetic activation scenario",
                        created_at=t,
                    )
                )
                db.add(
                    Audit(
                        user_id=user.id,
                        actor=name,
                        role="Field Agent",
                        action="Activation " + state.title(),
                        entity=o.id,
                        agent_id=agent.id,
                        new_value={"status": state},
                        created_at=t,
                    )
                )
            if i in [4, 6, 8]:
                db.add(
                    Alert(
                        agent_id=agent.id,
                        title={
                            2: "Outside assigned territory",
                            4: "Low available SIM stock",
                            6: "Identity requires manual review",
                            8: "Repeated identity verification attempts",
                        }[i],
                        severity="WARNING" if i in [2, 4] else "REVIEW",
                    )
                )
        db.commit()


if __name__ == "__main__":
    seed()
