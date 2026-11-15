"""citizens with reduced mobility (Hərəkət məhdudiyyətli şəxs)

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("citizens", sa.Column("mobility_impaired", sa.Boolean(), server_default=sa.false(),
                                        nullable=False))
    op.add_column("sos_signals", sa.Column("citizen_mobility_impaired", sa.Boolean(), server_default=sa.false(),
                                           nullable=False))


def downgrade() -> None:
    op.drop_column("sos_signals", "citizen_mobility_impaired")
    op.drop_column("citizens", "mobility_impaired")
