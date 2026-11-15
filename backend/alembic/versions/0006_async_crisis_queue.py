"""async crisis evaluation: sos_signals.evaluated_at

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sos_signals", sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True))
    # everything created before this migration was evaluated synchronously
    op.execute("UPDATE sos_signals SET evaluated_at = created_at WHERE is_suspected = false")


def downgrade() -> None:
    op.drop_column("sos_signals", "evaluated_at")
