"""Initial normalized schema and append-only audit guards."""
from alembic import op
from app.db import Base
revision='001'
down_revision=None


def upgrade():
    bind=op.get_bind()
    Base.metadata.create_all(bind)
    if bind.dialect.name=='postgresql':
        op.execute("""CREATE FUNCTION reject_audit_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Audit events are append-only'; END; $$ LANGUAGE plpgsql""")
        op.execute('CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()')
    else:
        op.execute("CREATE TRIGGER immutable_audit_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END")
        op.execute("CREATE TRIGGER immutable_audit_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END")


def downgrade():
    raise RuntimeError('Destructive downgrade requires an explicit retention and recovery procedure')
