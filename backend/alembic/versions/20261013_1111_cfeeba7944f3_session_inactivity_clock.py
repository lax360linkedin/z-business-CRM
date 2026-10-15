"""session inactivity clock

Revision ID: cfeeba7944f3
Revises: 54c59e6b3d5f
Create Date: 2026-10-13 11:11:28.657029
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'cfeeba7944f3'
down_revision: Union[str, None] = '54c59e6b3d5f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # sessions that already exist start their inactivity clock at the last time they were used, then the column becomes mandatory
    op.add_column('auth_sessions', sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE auth_sessions SET last_activity_at = last_used_at")
    op.alter_column('auth_sessions', 'last_activity_at', existing_type=sa.DateTime(timezone=True), nullable=False)


def downgrade() -> None:
    op.drop_column('auth_sessions', 'last_activity_at')
