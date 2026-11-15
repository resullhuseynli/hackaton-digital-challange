"""step-free (accessible) routing: road barriers, wheelchair-accessible points, accessible routes

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-15

Existing road graphs get no barriers (all step-free). Regenerate the graph to get them:
    python -m app.seed.build_graph --source synthetic
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# seed points with stairs/escalators only (kept in sync with app/seed/data.py NOT_WHEELCHAIR_ACCESSIBLE)
NOT_ACCESSIBLE = ("28 May metrosu sığınacağı", "Gənclik metrosu sığınacağı", "Nəriman Nərimanov metrosu sığınacağı",
                  "Xətai metrosu sığınacağı", "İnşaatçılar metrosu sığınacağı",
                  "Elmlər Akademiyası metrosu sığınacağı", "Qara Qarayev metrosu sığınacağı",
                  "Azadlıq prospekti metrosu sığınacağı", "Nizami kinoteatrı sığınacağı")


def upgrade() -> None:
    op.add_column("road_segments", sa.Column("barrier", sa.String(length=16), nullable=True))
    op.add_column("road_segments", sa.Column("base_barrier", sa.String(length=16), nullable=True))
    op.add_column("assembly_points", sa.Column("wheelchair_accessible", sa.Boolean(), server_default=sa.true(),
                                               nullable=False))
    op.add_column("routes", sa.Column("accessible", sa.Boolean(), server_default=sa.false(), nullable=False))
    points = sa.table("assembly_points", sa.column("name", sa.String), sa.column("wheelchair_accessible", sa.Boolean))
    op.execute(points.update().where(points.c.name.in_(NOT_ACCESSIBLE)).values(wheelchair_accessible=False))


def downgrade() -> None:
    op.drop_column("routes", "accessible")
    op.drop_column("assembly_points", "wheelchair_accessible")
    op.drop_column("road_segments", "base_barrier")
    op.drop_column("road_segments", "barrier")
