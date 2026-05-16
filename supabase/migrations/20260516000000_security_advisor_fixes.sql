-- Security Advisor fixes (2026-05-16)

-- 1. Revoke public execute from all SECURITY DEFINER functions.
--    Trigger functions (handle_new_user, assign_admin_on_signup, rls_auto_enable)
--    are called by the trigger mechanism as the function owner — regular roles
--    have no business calling them directly.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_admin_on_signup() FROM PUBLIC;

-- has_role is used in RLS policies which run in the authenticated context,
-- so authenticated must keep execute; only revoke from public (anon).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;

-- rls_auto_enable is a utility function, not user-callable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
  END IF;
END;
$$;

-- 2. Also revoke authenticated execute from the two trigger-only functions.
--    Triggers fire as the definer (postgres), not as the calling user.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_admin_on_signup() FROM authenticated;

-- 3. Fix mutable search_path on allowed_store_ids_for_current_user.
--    This function was created outside migrations; alter it in place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'allowed_store_ids_for_current_user'
  ) THEN
    ALTER FUNCTION public.allowed_store_ids_for_current_user() SET search_path = public;
  END IF;
END;
$$;

-- 4. Restrict the public music storage bucket.
--    Replace the broad public SELECT policy with one that only allows
--    authenticated users to read objects, not anonymous listing.
DELETE FROM storage.buckets WHERE id = 'music' AND public = true;
UPDATE storage.buckets SET public = false WHERE id = 'music';

-- Drop any overly-broad public storage policy on music if it exists.
DROP POLICY IF EXISTS "Public can read music" ON storage.objects;
DROP POLICY IF EXISTS "Give public access to music" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read on music" ON storage.objects;

-- Allow only authenticated users to read music files.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can read music'
  ) THEN
    CREATE POLICY "Authenticated users can read music"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (bucket_id = 'music');
  END IF;
END;
$$;
