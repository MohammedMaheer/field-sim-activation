"""Persist encrypted transaction captures and durable OCR jobs."""
from alembic import op
from app.db import KycCapture
revision = "002"
down_revision = "001"
def upgrade():
    KycCapture.__table__.create(op.get_bind(), checkfirst=True)
def downgrade():
    raise RuntimeError("Capture retention requires an explicit recovery procedure")
