"""Explicit owner-authorized operational reset; accounts and plans are preserved."""
import base64
import hashlib
import io
import json
import os
from datetime import timedelta
from sqlalchemy import delete, select
from PIL import Image, ImageDraw, ImageFont
from .db import (
    DB, User, Role, Agent, Branch, Outlet, Territory, Shift, Customer, Document,
    Ekyc, Order, Activation, OrderEvent, Sim, Movement, Location, Alert,
    Notification, Audit, Event, KycCapture, CaptureDraft, FieldTask, Incentive,
    SupportTicket, Plan, now, business_date,
)
from .security import cipher


def preservation_fingerprint():
    from .db import Permission, Session
    with DB() as db:
        values = {
            'accounts': sorted((u.id, u.name, u.email, u.password_hash, u.role_id) for u in db.scalars(select(User))),
            'permissions': sorted((p.role_id, p.name) for p in db.scalars(select(Permission))),
            'plans': sorted([tuple(str(getattr(p, col.name)) for col in Plan.__table__.columns) for p in db.scalars(select(Plan))]),
            'sessions': sorted((s.id, s.user_id, s.refresh_hash, str(s.expires), s.revoked) for s in db.scalars(select(Session))),
        }
        return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def picture(title, fields):
    image = Image.new('RGB', (1000, 760), '#ffffff')
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype('DejaVuSans.ttf', 26)
    except OSError:
        font = ImageFont.load_default(size=26)
    draw.rectangle((0, 0, 1000, 110), fill='#842757')
    draw.text((40, 35), title, fill='white', font=font)
    for i, (label, value) in enumerate(fields):
        draw.text((40, 150 + i * 62), f'{label}: {value}', fill='#24334a', font=font)
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


def reset_samples():
    if os.getenv('RELAY_RESET_OPERATIONAL_SAMPLES') != 'KEEP_ACCOUNTS_AND_PLANS':
        raise RuntimeError('Explicit operational reset authorization is required')
    with DB.begin() as db:
        admin = db.scalar(select(User).where(User.email == 'admin@relay.demo'))
        reviewer = db.scalar(select(User).join(Role).where(Role.name == 'Compliance Officer'))
        plans = list(db.scalars(select(Plan).where(Plan.active == True).order_by(Plan.name)))
        agents = list(db.scalars(select(Agent).order_by(Agent.employee_id)))
        if not admin or not reviewer or not plans or not agents:
            raise RuntimeError('Existing administrator, reviewer, active plan and agent accounts required')
        # Remove dependants first, in one transaction. The pre-reset database backup
        # preserves previous evidence and audit history independently of the demo.
        for model in (Activation, OrderEvent, KycCapture, CaptureDraft, Order, Ekyc,
                      Document, Customer, Movement, Sim, Shift, Location, Alert,
                      Notification, Event, FieldTask, Incentive, SupportTicket, Territory):
            db.execute(delete(model))
        branches, outlets = [], []
        for name, area in [('Marina Branch', 'Dubai Marina'), ('Downtown Branch', 'Downtown Dubai'), ('Yas Branch', 'Abu Dhabi')]:
            branch = Branch(name=name)
            db.add(branch)
            db.flush()
            outlet = Outlet(name=name, area=area, branch_id=branch.id, lat=0, lng=0)
            db.add(outlet)
            db.flush()
            branches.append(branch)
            outlets.append(outlet)
        old_outlets = [o.id for o in db.scalars(select(Outlet)) if o.id not in {o.id for o in outlets}]
        old_branches = [b.id for b in db.scalars(select(Branch)) if b.id not in {b.id for b in branches}]
        for user in db.scalars(select(User)):
            user.branch_id = branches[0].id
        stamp = now()
        for i, agent in enumerate(agents):
            agent.outlet_id = outlets[i % 3].id
            agent.leader_id = None
            agent.status = 'ACTIVE' if i < 4 else 'OFFLINE'
            agent.last_sync = stamp - timedelta(minutes=i)
            agent.lat = agent.lng = 0
            agent.target = 20
            db.get(User, agent.user_id).branch_id = branches[i % 3].id
            if i < 4:
                db.add(Shift(agent_id=agent.id, created_at=stamp - timedelta(hours=2)))
            db.add(Incentive(agent_id=agent.id, period=business_date().strftime('%Y-%m'), amount=150 + i * 10, note='Monthly sales incentive', source='DEMO'))
            db.add(SupportTicket(agent_id=agent.id, subject='SIM stock replenishment', message='Please replenish my physical SIM stock.', status='OPEN' if i == 0 else 'RESOLVED', response='' if i == 0 else 'Stock allocated to your branch.'))
            for slot in range(8):
                serial = f'SAMPLE-SIM-{i+1:02}-{slot+1:03}'
                sim = Sim(iccid=serial, serial=serial, sim_type='Physical' if slot % 3 else 'eSIM', status='AVAILABLE', agent_id=agent.id, outlet_id=agent.outlet_id, assigned_at=stamp)
                db.add(sim)
                db.flush()
                db.add(Movement(sim_id=sim.id, agent_id=agent.id, user_id=admin.id, old_status='WAREHOUSE', new_status='AVAILABLE', reason='Opening branch stock'))
        db.flush()
        for ident in old_outlets:
            db.execute(delete(Outlet).where(Outlet.id == ident))
        for ident in old_branches:
            db.execute(delete(Branch).where(Branch.id == ident))
        names = ['Avery Stone', 'Jordan Vale', 'Casey Rowan', 'Taylor Brooks', 'Morgan Lane', 'Riley Reed']
        for i, name in enumerate(names):
            agent = agents[i % len(agents)]
            plan = plans[i % len(plans)]
            sim = db.scalar(select(Sim).where(Sim.agent_id == agent.id).order_by(Sim.serial))
            reference = f'PAY-{business_date().strftime("%y%m%d")}-{i+1:04}'
            document = picture('IDENTITY DOCUMENT', [('Name', name), ('Document number', f'SAMPLE-ID-{i+1:04}'), ('Nationality', 'United Arab Emirates'), ('Date of birth', '1992-04-15'), ('Expiry date', '2031-04-15')])
            amount = f'AED {float(plan.monthly_cost):.2f}'
            pairs = [('Payment reference', reference), ('Customer', name), ('Total paid', amount), ('Payment method', 'Card'), ('Date', business_date().isoformat())]
            image = picture('PAYMENT CONFIRMATION', pairs)
            customer = Customer(agent_id=agent.id, name=name, mobile=f'SAMPLE-PHONE-{i+1:04}', nationality='United Arab Emirates')
            db.add(customer)
            db.flush()
            db.add(Document(customer_id=customer.id, document_type='Emirates ID', encrypted_number=cipher.encrypt(f'SAMPLE-ID-{i+1:04}'.encode()).decode(), expiry='2031-04-15'))
            state = ['SUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'VERIFIED', 'VALIDATED'][i]
            data = {'synthetic': True, 'document_kind': 'PAYMENT_CONFIRMATION', 'payment_reference': reference,
                    'intake': {'name': name, 'document_type': 'Emirates ID', 'document_number': f'SAMPLE-ID-{i+1:04}', 'nationality': customer.nationality, 'birth_date': '1992-04-15', 'expiry_date': '2031-04-15', 'document_image': base64.b64encode(document).decode(), 'sim_type': 'ESIM' if sim.sim_type == 'eSIM' else 'PHYSICAL', 'sim_identifier': sim.serial, 'plan_id': plan.id, 'plan_name': plan.name, 'msisdn': customer.mobile, 'signature': [[[.1+j*.05, .5+(j%3)*.05] for j in range(12)]]},
                    'plan_snapshot': {'name': plan.name, 'monthly_cost': float(plan.monthly_cost), 'promotion': plan.promotion},
                    'rows': [{'fields': [{'label': label, 'value': value, 'source_line': n, 'confidence': None} for n, (label, value) in enumerate(pairs)]}],
                    'lines': [{'text': f'{label}: {value}', 'confidence': None} for label, value in pairs],
                    'history': [{'action': 'Payment confirmation uploaded', 'actor': db.get(User, agent.user_id).name, 'at': stamp.isoformat(), 'status': 'SUBMITTED'}]}
            if state in {'VERIFIED', 'REJECTED'}:
                data['review'] = {'outcome': state, 'reviewer': reviewer.name, 'reason': 'Customer and payment details match' if state == 'VERIFIED' else 'Please upload a clearer payment confirmation', 'at': stamp.isoformat()}
                data['history'].append({'action': 'Payment verified' if state == 'VERIFIED' else 'Correction requested', 'actor': reviewer.name, 'at': stamp.isoformat(), 'status': state})
            capture = KycCapture(agent_id=agent.id, creator_id=agent.user_id, operation_id=f'sample-reset-{reference}', source_reference=reference, image_hash=hashlib.sha256(image).hexdigest(), image_type='image/png', image_encrypted=cipher.encrypt(image).decode(), status=state, reviewer_id=reviewer.id if state in {'VERIFIED','REJECTED'} else None)
            db.add(capture)
            db.flush()
            if i == 4:
                order = Order(reference='ORD-'+reference, request_id='REQ-'+reference, sr_id='SR-'+reference, msisdn=customer.mobile, customer_id=customer.id, agent_id=agent.id, plan_id=plan.id, sim_id=sim.id, status='ACTIVATED', operation_id='sample-order-'+reference, handling_seconds=220, draft={'synthetic': True})
                db.add(order)
                db.flush()
                db.add(Activation(order_id=order.id, status='ACTIVATED', provider_reference='SAMPLE-CARRIER-'+reference))
                db.add(OrderEvent(order_id=order.id, actor=admin.name, action='External activation recorded'))
                data['order_id'] = order.id
                data['activation'] = {'status': 'ACTIVATED', 'reference': 'SAMPLE-CARRIER-'+reference, 'reason': 'External completion recorded', 'actor': admin.name, 'at': stamp.isoformat()}
                sim.status, sim.activated_at = 'ACTIVATED', stamp
                db.add(Movement(sim_id=sim.id, agent_id=agent.id, user_id=admin.id, old_status='AVAILABLE', new_status='ACTIVATED', reason='External activation recorded'))
            capture.payload_encrypted = cipher.encrypt(json.dumps(data).encode()).decode()
            db.add(Audit(user_id=agent.user_id, actor=db.get(User, agent.user_id).name, role='Field Agent', action='Payment confirmation uploaded', entity=capture.id, agent_id=agent.id, new_value={'status': state}, source='Sample dataset'))
        db.add(Audit(user_id=admin.id, actor=admin.name, role='Administrator', action='Operational samples reset', entity='workspace', reason='Owner authorized reset; accounts and edited plans retained', source='Maintenance'))
    print('Operational samples reset; existing accounts, passwords, permissions and plans preserved.')


if __name__ == '__main__':
    reset_samples()
