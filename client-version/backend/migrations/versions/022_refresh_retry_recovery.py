"""Bounded durable recovery for lost refresh-rotation responses.

Existing sessions retain their current hashes. Nullable recovery state is
populated only on the next successful rotation; downgrade preserves sessions.
"""

from alembic import op
import sqlalchemy as sa

revision = "022"
down_revision = "021"


def upgrade():
    connection = op.get_bind()
    existing = {column["name"] for column in sa.inspect(connection).get_columns("device_sessions")}
    for column in (
        sa.Column("previous_refresh_hash", sa.String(64), nullable=True),
        sa.Column("refresh_retry_until", sa.DateTime(), nullable=True),
        sa.Column("refresh_retry_encrypted", sa.Text(), nullable=True),
    ):
        if column.name not in existing:
            op.add_column("device_sessions", column)
    indexes = {index["name"] for index in sa.inspect(connection).get_indexes("device_sessions")}
    if "ix_device_sessions_previous_refresh_hash" not in indexes:
        op.create_index(
            "ix_device_sessions_previous_refresh_hash", "device_sessions", ["previous_refresh_hash"]
        )


def downgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "ix_device_sessions_previous_refresh_hash" in {
        index["name"] for index in inspector.get_indexes("device_sessions")
    }:
        op.drop_index("ix_device_sessions_previous_refresh_hash", table_name="device_sessions")
    existing = {column["name"] for column in inspector.get_columns("device_sessions")}
    for name in ("refresh_retry_encrypted", "refresh_retry_until", "previous_refresh_hash"):
        if name in existing:
            op.drop_column("device_sessions", name)
