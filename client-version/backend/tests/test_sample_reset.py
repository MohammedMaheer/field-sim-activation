from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.db import Base, User, Plan, KycCapture, Branch, FieldTask
from app import sample_reset, seed as seed_module


def test_reset_preserves_accounts_and_edited_plans(tmp_path, monkeypatch):
    engine = create_engine('sqlite:///' + str(tmp_path / 'fresh.db'))
    Base.metadata.create_all(engine)
    db_factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(seed_module, 'DB', db_factory)
    monkeypatch.setattr(sample_reset, 'DB', db_factory)
    seed_module.seed()
    with db_factory.begin() as db:
        plan = db.scalar(select(Plan))
        plan.name, plan.monthly_cost = 'Owner edited plan', 399
    def identities():
        with db_factory() as db:
            return (sorted((u.id, u.email, u.name, u.password_hash, u.role_id) for u in db.scalars(select(User))),
                    sorted((p.id, p.name, str(p.monthly_cost), p.active) for p in db.scalars(select(Plan))))
    before = identities()
    monkeypatch.setenv('RELAY_RESET_OPERATIONAL_SAMPLES', 'KEEP_ACCOUNTS_AND_PLANS')
    sample_reset.reset_samples()
    assert identities() == before
    with db_factory() as db:
        assert len(list(db.scalars(select(KycCapture)))) == 6
        assert len(list(db.scalars(select(Branch)))) == 3
        assert not list(db.scalars(select(FieldTask)))
        for capture in db.scalars(select(KycCapture)):
            from app.captures import payload
            data = payload(capture)
            assert data['document_kind'] == 'PAYMENT_CONFIRMATION'
            assert data['intake']['document_image']
            assert data['synthetic'] is True
    engine.dispose()


def test_flexible_fields_keep_unknown_labels_and_multiline_values():
    from app.capture_ocr import organize_lines
    rows = organize_lines([{'text': 'Terminal location  Marina kiosk'}, {'text': 'Authorization code:'}, {'text': 'ABC123'}, {'text': 'Unclassified note'}])
    fields = rows[0]['fields']
    assert fields[0]['label'] == 'Terminal location'
    assert fields[0]['value'] == 'Marina kiosk'
    assert fields[1]['value'] == 'ABC123'
    assert fields[2]['value'] == 'Unclassified note'
