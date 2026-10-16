"""n8n automation runs

Revision ID: a91c3d27e5b4
Revises: f7108851b826
Create Date: 2026-10-16 15:00:00.000000

* automation_runs: the history of what the CRM handed to n8n workflows (trigger, record, status, attempts, answer / error), with row level security like every table.
Nothing existing is changed. The n8n connection and the workflow list live in app_settings (no schema change).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a91c3d27e5b4'
down_revision: Union[str, None] = 'f7108851b826'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_AND_REVOKE = """
DO $$
DECLARE t record; r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', current_schema(), r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', current_schema(), r);
    END IF;
  END LOOP;
END $$;
"""


def upgrade() -> None:
    op.create_table('automation_runs',
        sa.Column('id', sa.String(length=40), nullable=False),
        sa.Column('workflow_id', sa.String(length=40), nullable=False),
        sa.Column('workflow_name', sa.String(length=160), nullable=False),
        sa.Column('event', sa.String(length=60), nullable=False),
        sa.Column('trigger', sa.String(length=12), nullable=False),
        sa.Column('record_type', sa.String(length=40), nullable=True),
        sa.Column('record_id', sa.String(length=40), nullable=True),
        sa.Column('record_label', sa.String(length=200), nullable=False),
        sa.Column('branch', sa.String(length=40), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('response_code', sa.Integer(), nullable=True),
        sa.Column('message', sa.String(length=500), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('payload', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
        sa.Column('created_by', sa.String(length=40), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status in ('Queued','Running','Success','Failed')", name=op.f('ck_automation_runs_status')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_automation_runs')),
    )
    op.create_index(op.f('ix_automation_runs_workflow_id'), 'automation_runs', ['workflow_id'], unique=False)
    op.create_index('ix_automation_runs_status_created', 'automation_runs', ['status', 'created_at'], unique=False)
    if op.get_bind().dialect.name == 'postgresql':
        op.execute(RLS_AND_REVOKE)


def downgrade() -> None:
    op.drop_index('ix_automation_runs_status_created', table_name='automation_runs')
    op.drop_index(op.f('ix_automation_runs_workflow_id'), table_name='automation_runs')
    op.drop_table('automation_runs')
