"""route provenance for the resilient routing gateway (external API + local fallbacks)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("routes", sa.Column("source", sa.String(length=16), server_default="local_graph", nullable=False))
    op.add_column("routes", sa.Column("degraded", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    op.drop_column("routes", "degraded")
    op.drop_column("routes", "source")
