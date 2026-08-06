-- Prevent the owner's admin role from ever being deleted or demoted.
-- This fires BEFORE DELETE on user_roles and blocks any attempt to remove
-- the admin entry for the owner email.

CREATE OR REPLACE FUNCTION public.protect_owner_admin_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_email TEXT := 'karenbrandmeyer@gmail.com';
  target_email TEXT;
BEGIN
  -- Look up the email for the user_id being affected
  SELECT email INTO target_email
  FROM auth.users
  WHERE id = OLD.user_id;

  IF target_email = owner_email AND OLD.role = 'admin' THEN
    RAISE EXCEPTION 'Cannot remove admin role from the owner account.';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER prevent_owner_admin_delete
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_owner_admin_role();

-- Also block UPDATE that would change the owner's role away from admin
CREATE OR REPLACE FUNCTION public.protect_owner_admin_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_email TEXT := 'karenbrandmeyer@gmail.com';
  target_email TEXT;
BEGIN
  SELECT email INTO target_email
  FROM auth.users
  WHERE id = OLD.user_id;

  IF target_email = owner_email AND OLD.role = 'admin' AND NEW.role != 'admin' THEN
    RAISE EXCEPTION 'Cannot change the admin role of the owner account.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_owner_admin_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_owner_admin_role_update();

-- Re-seed admin just in case it's currently missing
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'karenbrandmeyer@gmail.com'
ON CONFLICT DO NOTHING;
