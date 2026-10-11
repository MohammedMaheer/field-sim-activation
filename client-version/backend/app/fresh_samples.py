"""Explicitly authorized evaluation refresh using the current screenshot workflow."""
import base64
import hashlib
import io
import json
import os
from datetime import datetime, timedelta
from sqlalchemy import delete, select
from openpyxl import Workbook
from .db import (Base, DB, Agent, Audit, Branch, CallAttempt, Customer, Document, FieldAsset,
                 FieldAssetMovement, FieldAssetRequest, KycCapture, Movement, NoSaleFeedback,
                 Notification, Outlet, Plan, Role, SalesCallTask, SavedCaptureDraft,
                 SalesRecord, SalesTarget, Sim, StockThreshold, SupportTicket, User,
                 business_date, now)
from .security import cipher


def refresh_samples(db_factory=DB):
    if os.getenv('RELAY_RESET_OPERATIONAL_SAMPLES') != 'KEEP_ACCOUNTS_AND_PLANS':
        raise RuntimeError('Explicit operational reset authorization is required')
    from .sample_reset import picture
    from .commissions import CommissionConfiguration
    from .sr_verification import SrBatch, SrCheck, SrNotice
    from .email_delivery import queue_sr_email
    from .sales_management import ORDER_TYPES, create_call_tasks, change_sale_status, assigned_manager
    from .capture_identity import claim_identities, identity_keys
    keep = {'roles', 'permissions', 'branches', 'users', 'device_sessions', 'outlets',
            'agents', 'products', 'plans', 'commission_policies', 'commission_configurations', 'audit_events'}
    with db_factory.begin() as db:
        admin = db.scalar(select(User).where(User.email == 'admin@relay.demo'))
        reviewer = db.scalar(select(User).join(Role).where(Role.name == 'Compliance Officer'))
        call_officers = {stage: list(db.scalars(select(User).join(Role).where(Role.name == role).order_by(User.id)))
                         for stage, role in [('TELE_VERIFICATION', 'Tele Verification Officer'),
                                             ('WELCOME_CALL', 'Welcome Call Officer')]}
        plans = list(db.scalars(select(Plan).where(Plan.active.is_(True), ~Plan.name.ilike('QA %')).order_by(Plan.name)))
        agents = list(db.scalars(select(Agent).join(Outlet).join(Branch).where(
            Agent.employment_status == 'ACTIVE', Branch.lifecycle_status == 'ACTIVE').order_by(Agent.employee_id)))
        if not admin or not reviewer or not plans or not agents:
            raise RuntimeError('Existing administrator, reviewer, active plan and sales agent accounts required')
        def call_actor(stage, branch_id):
            # Sample history must respect the retained officer's branch scope.
            # Independent backend staff handle branches with no scoped caller.
            return next((u for u in call_officers[stage] if not u.branch_id or u.branch_id == branch_id), reviewer)
        # Deployment backs up the database first. Clear dependencies atomically;
        # account identities, assignments and edited catalogs are kept intact.
        for table in reversed(Base.metadata.sorted_tables):
            if table.name not in keep:
                db.execute(delete(table))
        for config in db.scalars(select(CommissionConfiguration)):
            config.inputs = {**config.inputs, 'disconnected_sale_ids': [], 'gate_disconnected_sale_ids': []}
        stamp, day = now(), business_date()
        day_start = datetime.combine(day, datetime.min.time()) - timedelta(hours=4)
        stock = {}
        for index, agent in enumerate(agents):
            agent.last_sync = stamp - timedelta(minutes=index)
            agent.status = 'ACTIVE' if index < 3 else 'OFFLINE'
            for product in ORDER_TYPES:
                db.add(SalesTarget(agent_id=agent.id, period=day.strftime('%Y-%m'), order_type=product,
                    daily_target=2 if product == 'NEW' else 1, monthly_target=40 if product == 'NEW' else 20, set_by=admin.id))
            stock[agent.id] = []
            for slot in range(4):
                serial = f'8997100{index+1:04d}{slot+1:08d}'
                sim = Sim(iccid=serial, serial=serial, sim_type='Physical' if slot % 3 else 'eSIM', status='AVAILABLE',
                    agent_id=agent.id, outlet_id=agent.outlet_id, assigned_at=stamp,
                    business_category=['Postpaid', 'Wasel / Prepaid', 'Home Wireless', 'Visitor'][slot])
                db.add(sim)
                db.flush()
                stock[agent.id].append(sim)
                db.add(Movement(sim_id=sim.id, agent_id=agent.id, user_id=admin.id,
                    old_status='WAREHOUSE', new_status='AVAILABLE', reason='Opening branch balance'))
        for branch_id in sorted({db.get(Outlet, a.outlet_id).branch_id for a in agents}):
            for category, label, quantity in [('ROUTER', 'Home Wireless router', 1),
                                              ('TABLET', 'Sales tablet', 1), ('UNIFORM', 'Staff polo', 3)]:
                asset = FieldAsset(category=category, label=label,
                    serial=category+'-'+branch_id[:8] if category != 'UNIFORM' else None,
                    quantity=quantity, status='AVAILABLE', branch_id=branch_id,
                    warehouse='Branch store', condition='New', size='M' if category == 'UNIFORM' else '')
                db.add(asset)
                db.flush()
                db.add(FieldAssetMovement(asset_id=asset.id, from_branch_id=branch_id, to_branch_id=branch_id,
                    actor_id=admin.id, quantity_delta=quantity, reason='Opening branch balance'))
            db.add(StockThreshold(branch_id=branch_id, category='ROUTER', minimum=2, actor_id=admin.id))
        names = ['Avery Stone', 'Jordan Vale', 'Casey Rowan', 'Taylor Brooks', 'Morgan Lane',
                 'Riley Reed', 'Noah Ellis', 'Maya Hart', 'Leila Quinn', 'Alex Bell',
                 'Sam Rivers', 'Robin Hayes', 'Kai Parker', 'Emery West']
        sample_agents = agents
        batches, reports, batch_counts = {}, {}, {}
        for report_day in (day, day - timedelta(days=1)):
            book = Workbook()
            book.active.append(['SR number', 'Request ID', 'Status'])
            reports[report_day] = book
            batch = SrBatch(business_date=report_day.isoformat(),
                fingerprint=hashlib.sha256(('fresh-'+report_day.isoformat()).encode()).hexdigest(),
                filename='Daily-SR-'+report_day.isoformat()+'.xlsx', actor_id=reviewer.id,
                report_encrypted='', summary={})
            db.add(batch)
            batches[report_day] = batch
            batch_counts[report_day] = {'matched': 0, 'mismatch': 0, 'pending': 0}
        db.flush()
        for index, name in enumerate(names):
            agent = sample_agents[index % len(sample_agents)]
            outlet, plan = db.get(Outlet, agent.outlet_id), plans[index % len(plans)]
            reference, sr = f'REQ-{day:%y%m%d}-{index+1:03}', f'SR-{day:%y%m%d}-{index+1:03}'
            phone, doc = f'050000{index+1:04}', f'784-1992-000{index+1:04}-1'
            product = ORDER_TYPES[index % len(ORDER_TYPES)]
            product_label = {'NEW': 'New postpaid', 'MNP': 'MNP postpaid', 'P2P': 'Prepaid to postpaid',
                             'HW': 'Home Wireless', 'ELIFE': 'eLife', 'WASEL': 'Wasel prepaid', 'VISITOR': 'Visitor'}[product]
            # Use retained mobile catalog entries for mobile products. HW/eLife
            # screenshots carry their own package label; absent carrier charges
            # stay unrecorded rather than borrowing a mobile-plan price.
            if product in {'WASEL', 'VISITOR'}:
                plan = next((p for p in plans if 'prepaid' in p.name.casefold()), plan)
            elif product in {'NEW', 'MNP', 'P2P'}:
                plan = next((p for p in plans if 'postpaid' in p.name.casefold()), plan)
            package_name = product_label if product in {'HW', 'ELIFE'} else plan.name
            monthly_cost = '' if product in {'HW', 'ELIFE'} else str(plan.monthly_cost)
            document = picture('CUSTOMER DETAILS', [('Full name', name), ('Document Type', 'UAE Identity card'),
                ('Document Number', doc), ('Nationality', 'United Arab Emirates'), ('Date of Birth', '15-Apr-1992'),
                ('Issue Date', '16-Apr-2021'), ('Expiry Date', '15-Apr-2031'),
                ('Sex', 'Female' if index % 2 else 'Male')])
            fields = [('Product Name', product_label), ('Package Name', package_name), ('MSISDN', phone),
                ('Request Id', reference), ('SR number', sr), ('Account number', f'ACC-{index+1:06}'),
                ('Order prepayment', '0')]
            if monthly_cost:
                fields.append(('Monthly charge', monthly_cost))
            order = picture('ORDER DETAILS', fields)
            payment = picture('PAYMENT RECEIPT', [('SR number', sr), ('Request Id', reference), ('Customer', name)]) if index % 2 == 0 else b''
            recorded_at = max(stamp - timedelta(minutes=index * 2), day_start)
            if index == 6:
                recorded_at -= timedelta(days=1)
            customer = Customer(agent_id=agent.id, name=name, mobile=phone, nationality='United Arab Emirates', created_at=recorded_at)
            db.add(customer)
            db.flush()
            db.add(Document(customer_id=customer.id, document_type='Emirates ID', encrypted_number=cipher.encrypt(doc.encode()).decode(), expiry='2031-04-15'))
            state = 'SUBMITTED' if index in {0, 3, 8, 11, 13} else 'REJECTED' if index == 5 else 'VERIFIED'
            sale_status = 'CANCELLED' if index == 6 else 'CLOSED' if state == 'VERIFIED' else 'IN_PROGRESS'
            intake = {'capture_mode': 'SCREENSHOT_SALE', 'name': name, 'document_type': 'Emirates ID', 'document_number': doc,
                'nationality': customer.nationality, 'birth_date': '1992-04-15', 'issue_date': '2021-04-16', 'expiry_date': '2031-04-15',
                'gender': 'Female' if index % 2 else 'Male', 'document_image': base64.b64encode(document).decode(),
                'order_image': base64.b64encode(order).decode(), 'payment_image': base64.b64encode(payment).decode() if payment else '',
                'order_reference': reference, 'sr_number': sr, 'order_type': product, 'product_name': product_label,
                'package_name': package_name, 'plan_name': plan.name, 'plan_id': plan.id, 'msisdn': phone,
                'monthly_cost': monthly_cost, 'prepayment': '0', 'account_number': f'ACC-{index+1:06}',
                'router_fulfilment': ('WITHOUT_ROUTER' if index == 10 else 'DELIVERY') if product == 'HW' else '',
                'sim_identifier': '', 'sim_type': 'PHYSICAL'}
            data = {'synthetic': True, 'document_kind': 'SALE_SCREENSHOTS', 'intake': intake,
                'plan_snapshot': {'name': plan.name, 'monthly_cost': float(plan.monthly_cost), 'promotion': plan.promotion},
                'rows': [{'fields': [{'label': label, 'value': value, 'source_line': n, 'confidence': None} for n, (label, value) in enumerate(fields)]}],
                'lines': [{'text': f'{label}: {value}', 'confidence': None} for label, value in fields],
                'history': [{'action': 'Sale recorded', 'actor': db.get(User, agent.user_id).name, 'at': recorded_at.isoformat(), 'status': 'SUBMITTED'}]}
            if state != 'SUBMITTED':
                data['review'] = {'outcome': state, 'reviewer': reviewer.name,
                    'reason': 'Customer and order evidence checked' if state == 'VERIFIED' else 'A clearer order screen is needed', 'at': stamp.isoformat()}
            capture = KycCapture(branch_id=outlet.branch_id, agent_id=agent.id, creator_id=agent.user_id, operation_id='fresh-'+reference,
                source_reference=reference, image_hash=hashlib.sha256(order).hexdigest(), image_type='image/png',
                image_encrypted=cipher.encrypt(order).decode(), payload_encrypted=cipher.encrypt(json.dumps(data).encode()).decode(),
                status=state, reviewer_id=reviewer.id if state != 'SUBMITTED' else None, created_at=recorded_at)
            db.add(capture)
            db.flush()
            sale = SalesRecord(capture_id=capture.id, agent_id=agent.id, leader_id=agent.leader_id,
                manager_id=assigned_manager(db, outlet.branch_id),
                branch_id=outlet.branch_id, outlet_id=outlet.id, order_type=product, customer_name=name,
                nationality=customer.nationality, document_encrypted=cipher.encrypt(doc.encode()).decode(), plan_name=package_name,
                request_id=reference, status=sale_status, created_at=recorded_at, details={'customer_id': customer.id, 'sr_number': sr,
                    'msisdn': phone, 'account_number': intake['account_number'], 'monthly_cost': monthly_cost, 'prepayment': '0',
                    'router_fulfilment': intake['router_fulfilment'],
                    'assignment_effective_at': agent.assignment_effective_at.isoformat() if agent.assignment_effective_at else '',
                    'employee_id': agent.employee_id,
                    'payment_record_status': 'RECORDED' if payment else 'NOT_RECORDED'})
            db.add(sale)
            db.flush()
            claim_identities(db, identity_keys(request_ids=[reference], sr_numbers=[sr], encoded_images=[intake['order_image'], intake['payment_image']]), capture_id=capture.id, sale_id=sale.id)
            create_call_tasks(db, sale)
            if sale_status == 'CLOSED':
                tasks = list(db.scalars(select(SalesCallTask).where(SalesCallTask.sale_id == sale.id)))
                for task in tasks:
                    task.status = 'COMPLETED' if task.stage == 'TELE_VERIFICATION' or index == 9 else 'PENDING'
                    task.last_outcome = 'PASSED' if task.status == 'COMPLETED' else ''
                if tasks:
                    db.add(CallAttempt(sale_id=sale.id, stage='TELE_VERIFICATION', outcome='PASSED', remark='Customer details confirmed', actor_id=call_actor('TELE_VERIFICATION', sale.branch_id).id))
                    if index == 9:
                        db.add(CallAttempt(sale_id=sale.id, stage='WELCOME_CALL', outcome='PASSED', remark='Welcome call completed', actor_id=call_actor('WELCOME_CALL', sale.branch_id).id))
            if index == 8:
                sale.details = {**sale.details, 'tele_deferred_until': (day + timedelta(days=1)).isoformat(),
                                'tele_defer_reason': 'Customer line temporarily unavailable',
                                'tele_deferred_by': reviewer.id, 'tele_deferred_at': stamp.isoformat()}
            sr_state = 'MISMATCH' if index in {1, 8} else 'PENDING_SR_VERIFICATION' if index in {0, 3, 7, 11, 13} else 'MATCHED'
            reason = 'SR number was not found in the daily report' if sr_state == 'MISMATCH' else 'Daily SR report not checked' if sr_state != 'MATCHED' else 'SR and request ID match the daily report'
            report_day = business_date(recorded_at)
            batch = batches[report_day]
            db.add(SrCheck(sale_id=sale.id, business_date=report_day.isoformat(), batch_id=batch.id, status=sr_state, reason=reason))
            batch_counts[report_day][{'MATCHED': 'matched', 'MISMATCH': 'mismatch', 'PENDING_SR_VERIFICATION': 'pending'}[sr_state]] += 1
            if sr_state == 'MATCHED':
                reports[report_day].active.append([sr, reference, sale_status])
            for user_id in {agent.user_id, agent.leader_id} - {None}:
                db.add(SrNotice(user_id=user_id, sale_id=sale.id, batch_id=batch.id, status=sr_state, reason=reason))
                if sr_state != 'MATCHED':
                    queue_sr_email(db, sale, user_id, batch.id, sr_state, reason, evaluation=True)
            if (sale_status == 'CLOSED' or sale_status == 'CANCELLED') and product != 'ELIFE':
                category = {'HW': 'Home Wireless', 'WASEL': 'Wasel / Prepaid', 'VISITOR': 'Visitor'}.get(product, 'Postpaid')
                available = next((s for s in stock[agent.id] if s.status == 'AVAILABLE' and s.business_category == category), None)
                if available:
                    sale.details = {**sale.details, 'sim_serial': available.serial}
                    intake['sim_identifier'] = available.serial
                    intake['sim_type'] = 'ESIM' if available.sim_type == 'eSIM' else 'PHYSICAL'
                    capture.payload_encrypted = cipher.encrypt(json.dumps(data).encode()).decode()
                    change_sale_status(db, sale, 'CLOSED', reviewer, None)
                    if sale_status == 'CANCELLED':
                        change_sale_status(db, sale, 'CANCELLED', reviewer, None)
                        sale.details = {**sale.details, 'cancellation_reason': 'Cancelled in the daily carrier report'}
        for report_day, batch in batches.items():
            stream = io.BytesIO()
            reports[report_day].save(stream)
            report_bytes = stream.getvalue()
            batch.report_encrypted = cipher.encrypt(report_bytes).decode()
            batch.fingerprint = hashlib.sha256(report_bytes).hexdigest()
            batch.summary = batch_counts[report_day]
        db.add(SupportTicket(agent_id=sample_agents[0].id, subject='Additional SIM stock', message='Please allocate additional SIMs to the branch.', status='OPEN'))
        db.add(SupportTicket(agent_id=sample_agents[-1].id, subject='Order screen capture',
            message='Please confirm which order screen to capture.', status='RESOLVED',
            response='Capture the full order details screen with the customer phone and request ID visible.'))
        first = sample_agents[0]
        db.add(FieldAssetRequest(agent_id=first.id, branch_id=db.get(Outlet, first.outlet_id).branch_id,
            category='ROUTER', quantity=1, reason='Upcoming Home Wireless sale', urgency='NORMAL'))
        draft = SavedCaptureDraft(creator_id=first.user_id)
        db.add(draft)
        db.flush()
        draft.payload_encrypted = cipher.encrypt(json.dumps({
            'step': 0, 'capture_mode': 'SCREENSHOT_SALE', 'document_type': 'Emirates ID',
            'name': 'Jamie Cole', 'saved_draft_id': draft.id}).encode()).decode()
        db.add(NoSaleFeedback(agent_id=first.id, leader_id=first.leader_id,
            branch_id=db.get(Outlet, first.outlet_id).branch_id, customer_name='Drew Hill',
            product_suggested='Home Wireless', feedback='Customer requested a follow-up next week',
            rejection_reason='Not ready to purchase'))
        db.add(Notification(user_id=admin.id, message='Fresh branch sales, SR queues and stock are ready.'))
        db.add(Audit(user_id=admin.id, actor=admin.name, role='Administrator', action='Operational samples refreshed', entity='workspace',
            reason='Owner authorized fresh evaluation records; accounts, assignments, edited plans and approved policies retained', source='Maintenance'))
    print('Fresh screenshot sales, SR/call queues, product targets and branch stock created; accounts and edited plans preserved.')
