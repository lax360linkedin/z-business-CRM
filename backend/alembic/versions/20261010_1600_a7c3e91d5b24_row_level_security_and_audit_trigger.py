"""row level security on every table, no API-role access, append-only audit trail

Supabase exposes the `public` schema through its REST API using the `anon` / `authenticated` roles. This backend is the only intended door to the data (it connects as the
table owner, which bypasses RLS), so every table gets RLS enabled with NO policies - the REST API then returns nothing - and the API roles lose their table privileges.
Rule for later migrations: a new table must `ENABLE ROW LEVEL SECURITY` too (see `enable_rls_everywhere()` below).

Revision ID: a7c3e91d5b24
Revises: 0fd854cf8490
Create Date: 2026-10-10 16:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a7c3e91d5b24"
down_revision: Union[str, None] = "0fd854cf8490"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENABLE_RLS_EVERYWHERE = """
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
"""

REVOKE_API_ROLES = """
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', current_schema(), r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', current_schema(), r);
    END IF;
  END LOOP;
END $$;
"""


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(ENABLE_RLS_EVERYWHERE)
    op.execute(REVOKE_API_ROLES)
    op.execute("""
        CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'audit_logs is append-only';
        END $$;
    """)
    op.execute("CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_change ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only()")
    op.execute("""
        DO $$
        DECLARE t record;
        BEGIN
          FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
            EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t.tablename);
          END LOOP;
        END $$;
    """)
