"""lead source management

Revision ID: f7108851b826
Revises: 0be1a48665f2
Create Date: 2026-10-13 12:52:38.644449

* lead sources: a normalised name key (backfilled) and uniqueness per scope - one COMMON source per name, one per name inside each branch;
* lead_source_integrations: metadata about the integrations feeding a source (no credentials), with row level security like every table;
* enquiries and leads: optional attribution fields (source category, ad, landing page, UTM, referring employee, how the record was created).
Existing rows are kept exactly as they are; every new column starts empty.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f7108851b826'
down_revision: Union[str, None] = '0be1a48665f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ATTRIBUTION = (('source_category', 60), ('ad_name', 160), ('ad_id', 80), ('landing_page', 200), ('utm_source', 120), ('utm_medium', 120), ('utm_campaign', 160), ('utm_content', 160), ('created_via', 30))

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
    op.create_table('lead_source_integrations',
        sa.Column('source_id', sa.String(length=40), nullable=False),
        sa.Column('provider', sa.String(length=60), nullable=False),
        sa.Column('account_name', sa.String(length=160), nullable=False),
        sa.Column('mapped_branch', sa.String(length=40), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(length=500), nullable=False),
        sa.Column('notes', sa.String(length=500), nullable=False),
        sa.Column('id', sa.String(length=40), nullable=False),
        sa.Column('attributes', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
        sa.Column('created_by', sa.String(length=40), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status in ('Not Connected','Connected','Error','Inactive')", name=op.f('ck_lead_source_integrations_status')),
        sa.ForeignKeyConstraint(['mapped_branch'], ['branches.name'], name=op.f('fk_lead_source_integrations_mapped_branch_branches'), onupdate='CASCADE', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['source_id'], ['lead_sources.id'], name=op.f('fk_lead_source_integrations_source_id_lead_sources'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_lead_source_integrations')))
    op.create_index(op.f('ix_lead_source_integrations_mapped_branch'), 'lead_source_integrations', ['mapped_branch'], unique=False)
    op.create_index(op.f('ix_lead_source_integrations_source_id'), 'lead_source_integrations', ['source_id'], unique=False)

    for table in ('enquiries', 'leads'):  # optional attribution: every existing row simply has none yet
        for column, length in ATTRIBUTION:
            op.add_column(table, sa.Column(column, sa.String(length=length), nullable=False, server_default=''))
        op.add_column(table, sa.Column('referring_employee_id', sa.String(length=60), nullable=True))
        op.create_index(op.f(f'ix_{table}_referring_employee_id'), table, ['referring_employee_id'], unique=False)

    # source names: normalised key (lower case, letters and digits only), then uniqueness per scope instead of one global lower(name)
    op.add_column('lead_sources', sa.Column('name_key', sa.String(length=160), nullable=True))
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("UPDATE lead_sources SET name_key = lower(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))")
    else:
        op.execute("UPDATE lead_sources SET name_key = lower(replace(replace(replace(name, ' ', ''), '-', ''), '/', ''))")
    op.alter_column('lead_sources', 'name_key', existing_type=sa.String(length=160), nullable=False)
    op.drop_index(op.f('uq_lead_sources_name_lower'), table_name='lead_sources')
    op.create_index('uq_lead_sources_branch_name', 'lead_sources', ['branch', 'name_key'], unique=True, postgresql_where=sa.text('branch IS NOT NULL'), sqlite_where=sa.text('branch IS NOT NULL'))
    op.create_index('uq_lead_sources_common_name', 'lead_sources', ['name_key'], unique=True, postgresql_where=sa.text('branch IS NULL'), sqlite_where=sa.text('branch IS NULL'))

    if op.get_bind().dialect.name == 'postgresql':
        op.execute(RLS_AND_REVOKE)  # the new table follows the same rule as every other: no access for the API roles, the backend is the only way in


def downgrade() -> None:
    op.drop_index('uq_lead_sources_common_name', table_name='lead_sources', postgresql_where=sa.text('branch IS NULL'), sqlite_where=sa.text('branch IS NULL'))
    op.drop_index('uq_lead_sources_branch_name', table_name='lead_sources', postgresql_where=sa.text('branch IS NOT NULL'), sqlite_where=sa.text('branch IS NOT NULL'))
    op.create_index(op.f('uq_lead_sources_name_lower'), 'lead_sources', [sa.literal_column('lower(name::text)')], unique=True)
    op.drop_column('lead_sources', 'name_key')
    for table in ('leads', 'enquiries'):
        op.drop_index(op.f(f'ix_{table}_referring_employee_id'), table_name=table)
        op.drop_column(table, 'referring_employee_id')
        for column, _ in reversed(ATTRIBUTION):
            op.drop_column(table, column)
    op.drop_index(op.f('ix_lead_source_integrations_source_id'), table_name='lead_source_integrations')
    op.drop_index(op.f('ix_lead_source_integrations_mapped_branch'), table_name='lead_source_integrations')
    op.drop_table('lead_source_integrations')
