-- Ensure the owner account has admin role regardless of when it was created.
-- The assign_admin_on_signup trigger only fires on INSERT, so accounts created
-- before that migration was applied need this backfill.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'karenbrandmeyer@gmail.com'
ON CONFLICT DO NOTHING;
