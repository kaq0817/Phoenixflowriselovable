-- Explicit Data API grants (Supabase rollout: 2026-05-30 / 2026-10-30)
--
-- Supabase is changing defaults so new tables created in the `public` schema
-- are NOT exposed to the Data API (PostgREST/GraphQL) unless privileges are
-- explicitly granted. This migration preserves the previous "public tables are
-- queryable (subject to RLS)" behavior by granting privileges to Supabase API roles.
--
-- Notes:
-- - These grants DO NOT bypass RLS. Keep RLS enabled and policies correct.
-- - We intentionally do NOT grant EXECUTE on functions (security advisor hardening).

DO $$
DECLARE
  api_roles text[];
  api_roles_sql text;
BEGIN
  SELECT array_agg(quote_ident(rolname) ORDER BY rolname)
    INTO api_roles
  FROM pg_roles
  WHERE rolname IN ('anon', 'authenticated', 'service_role');

  IF api_roles IS NULL THEN
    RAISE NOTICE 'No Supabase API roles found (anon/authenticated/service_role); skipping Data API grants.';
    RETURN;
  END IF;

  api_roles_sql := array_to_string(api_roles, ', ');

  -- Allow PostgREST/GraphQL to access objects in `public` (subject to RLS/policies).
  EXECUTE 'GRANT USAGE ON SCHEMA public TO ' || api_roles_sql;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ' || api_roles_sql;
  EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ' || api_roles_sql;

  -- Ensure future tables/sequences created by migrations remain accessible.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ' || api_roles_sql;
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ' || api_roles_sql;
END
$$;

