"""Final imported commission amounts kept separate from calculated estimates."""
from alembic import op
revision='021'
down_revision='020'

def upgrade():
    from app.final_incentives import FinalIncentive
    FinalIncentive.__table__.create(op.get_bind(),checkfirst=True)

def downgrade():
    op.drop_table('final_incentives')
