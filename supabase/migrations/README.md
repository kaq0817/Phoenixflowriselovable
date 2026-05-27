# Supabase migrations

## Data API exposure (May/Oct 2026 change)

Supabase is rolling out a change to Data API exposure for tables created in the `public` schema:

- **May 30, 2026**: new Supabase projects no longer expose `public` tables to the Data API by default.
- **October 30, 2026**: enforced for new tables across existing projects.

This repo includes `supabase/migrations/20260527000000_explicit_data_api_grants.sql` to add explicit grants for `anon`, `authenticated`, and `service_role` so tables in `public` remain accessible to PostgREST/GraphQL **subject to RLS**.

