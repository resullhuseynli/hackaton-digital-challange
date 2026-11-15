"""SOS flood protection (quarantine, duplicates, device age) and dispatcher RBAC

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("citizens", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                                        nullable=False))
    op.create_index("ix_citizens_created_at", "citizens", ["created_at"])

    op.add_column("sos_signals", sa.Column("is_suspected", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("sos_signals", sa.Column("suspicion_reason", sa.String(length=32), nullable=True))
    op.add_column("sos_signals", sa.Column("duplicate_count", sa.Integer(), server_default="0", nullable=False))
    op.add_column("sos_signals", sa.Column("source_ip_hash", sa.String(length=32), nullable=True))
    op.create_index("ix_sos_signals_source_ip_hash", "sos_signals", ["source_ip_hash"])
    op.create_index("ix_sos_signals_queue", "sos_signals", ["is_suspected", "status"])

    op.add_column("dispatchers", sa.Column("role", sa.String(length=16), server_default="dispatcher", nullable=False))
    op.add_column("dispatchers", sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False))
    # the seeded account keeps full access
    op.execute("UPDATE dispatchers SET role = 'admin' WHERE username = 'admin'")


def downgrade() -> None:
    op.drop_column("dispatchers", "is_active")
    op.drop_column("dispatchers", "role")
    op.drop_index("ix_sos_signals_queue", table_name="sos_signals")
    op.drop_index("ix_sos_signals_source_ip_hash", table_name="sos_signals")
    op.drop_column("sos_signals", "source_ip_hash")
    op.drop_column("sos_signals", "duplicate_count")
    op.drop_column("sos_signals", "suspicion_reason")
    op.drop_column("sos_signals", "is_suspected")
    op.drop_index("ix_citizens_created_at", table_name="citizens")
    op.drop_column("citizens", "created_at")
