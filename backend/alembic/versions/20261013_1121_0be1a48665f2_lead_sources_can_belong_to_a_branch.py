"""lead sources can belong to a branch

Revision ID: 0be1a48665f2
Revises: cfeeba7944f3
Create Date: 2026-10-13 11:21:33.189549
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0be1a48665f2'
down_revision: Union[str, None] = 'cfeeba7944f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # existing sources have no branch: they stay SHARED by every branch
    op.add_column('lead_sources', sa.Column('branch', sa.String(length=40), nullable=True))
    op.create_index(op.f('ix_lead_sources_branch'), 'lead_sources', ['branch'], unique=False)
    op.create_foreign_key(op.f('fk_lead_sources_branch_branches'), 'lead_sources', 'branches', ['branch'], ['name'], onupdate='CASCADE', ondelete='RESTRICT')


def downgrade() -> None:
    op.drop_constraint(op.f('fk_lead_sources_branch_branches'), 'lead_sources', type_='foreignkey')
    op.drop_index(op.f('ix_lead_sources_branch'), table_name='lead_sources')
    op.drop_column('lead_sources', 'branch')
