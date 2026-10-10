from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.db import Base, User, Plan, KycCapture, Branch, FieldTask, Agent, SalesRecord, SalesTarget, Audit
from app import sample_reset, seed as seed_module


def test_reset_preserves_accounts_and_edited_plans(tmp_path, monkeypatch):
    from app import commissions, sr_verification, email_delivery  # noqa: F401
    engine = create_engine('sqlite:///' + str(tmp_path / 'fresh.db'))
    Base.metadata.create_all(engine)
    db_factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(seed_module, 'DB', db_factory)
    monkeypatch.setattr(sample_reset, 'DB', db_factory)
    seed_module.seed()
    with db_factory.begin() as db:
        plan = db.scalar(select(Plan))
        plan.name, plan.monthly_cost = 'Owner edited plan', 399
        # Preserved real account emails must never receive synthetic SR alerts.
        for index, person in enumerate(db.scalars(select(User))):
            person.email = f'preserved-account-{index}@real-company.com'
        db.scalar(select(User).where(User.name == 'Alex Morgan')).email = 'admin@relay.demo'
    def identities():
        with db_factory() as db:
            return (sorted((u.id, u.email, u.name, u.password_hash, u.role_id) for u in db.scalars(select(User))),
                    sorted((p.id, p.name, str(p.monthly_cost), p.active) for p in db.scalars(select(Plan))))
    before = identities()
    with db_factory() as db:
        assignments = sorted((a.id, a.outlet_id, a.leader_id) for a in db.scalars(select(Agent)))
        branches = sorted((b.id, b.name) for b in db.scalars(select(Branch)))
        audit_ids = {a.id for a in db.scalars(select(Audit))}
    monkeypatch.setenv('RELAY_RESET_OPERATIONAL_SAMPLES', 'KEEP_ACCOUNTS_AND_PLANS')
    sample_reset.reset_samples()
    assert identities() == before
    with db_factory() as db:
        assert len(list(db.scalars(select(KycCapture)))) == 9
        assert sorted((b.id, b.name) for b in db.scalars(select(Branch))) == branches
        assert sorted((a.id, a.outlet_id, a.leader_id) for a in db.scalars(select(Agent))) == assignments
        assert audit_ids <= {a.id for a in db.scalars(select(Audit))}
        assert len(list(db.scalars(select(SalesRecord)))) == 9
        outbox = list(db.scalars(select(email_delivery.EmailOutbox)))
        assert outbox
        assert all(item.status == 'SKIPPED' and item.attempts == 0 for item in outbox)
        from app.sales_management import ORDER_TYPES
        assert {t.order_type for t in db.scalars(select(SalesTarget))} == set(ORDER_TYPES)
        assert not list(db.scalars(select(FieldTask)))
        for capture in db.scalars(select(KycCapture)):
            from app.captures import payload, Intake
            data = payload(capture)
            assert data['document_kind'] == 'SALE_SCREENSHOTS'
            assert data['intake']['capture_mode'] == 'SCREENSHOT_SALE'
            assert data['intake']['sr_number']
            assert data['intake']['order_image']
            assert data['intake']['document_image']
            assert data['synthetic'] is True
            Intake.model_validate(data['intake']).complete()
    # A second explicit reset clears every dependent table and leaves one small
    # current dataset, rather than growing queues or duplicate claims each run.
    sample_reset.reset_samples()
    assert identities() == before
    with db_factory() as db:
        assert len(list(db.scalars(select(SalesRecord)))) == 9
    engine.dispose()


def test_flexible_fields_keep_unknown_labels_and_multiline_values():
    from app.capture_ocr import organize_lines
    rows = organize_lines([{'text': 'Terminal location  Marina kiosk'}, {'text': 'Authorization code:'}, {'text': 'ABC123'}, {'text': 'Unclassified note'}])
    fields = rows[0]['fields']
    assert fields[0]['label'] == 'Terminal location'
    assert fields[0]['value'] == 'Marina kiosk'
    assert fields[1]['value'] == 'ABC123'
    assert fields[2]['value'] == 'Unclassified note'
