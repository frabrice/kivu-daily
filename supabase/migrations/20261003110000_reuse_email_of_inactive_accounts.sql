/*
# Reusing a former employee's email; locking out deactivated accounts

Confirmed with the operator: an email that belonged to someone who was
terminated or deactivated must be usable for a new account, as long as
no *active* account has it (e.g. re-hiring someone, or a new person
inheriting a role mailbox).

Supabase allows one sign-in per email, so the old account's sign-in
email is moved to a unique archived address that can't receive mail
(archived+<id>@archived.kivu-daily.invalid), freeing the real one. The
old profile row, its tasks, payroll link and history all stay exactly
as they were - profiles.email still shows the address they used - and
the new person gets a fresh account.

While building this it turned out deactivation never stopped anyone
signing in: profiles.is_active = false hid people from lists, but their
login kept working. Deactivating now also bans the sign-in and ends
every open session (and reactivating lifts the ban), via a trigger on
profiles so it applies however is_active is changed. Existing inactive
accounts are locked out by the backfill at the end.

find_account_by_email and archive_account_email are callable only by
the service role (the create-user Edge Function), never by the app.
*/

CREATE OR REPLACE FUNCTION find_account_by_email(p_email text)
RETURNS TABLE (user_id uuid, is_active boolean, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT u.id, COALESCE(p.is_active, false), p.full_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = lower(trim(p_email));
$$;

CREATE OR REPLACE FUNCTION archive_account_email(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_archived text := 'archived+' || replace(p_user_id::text, '-', '') || '@archived.kivu-daily.invalid';
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_active) THEN
    RAISE EXCEPTION 'This account is still active';
  END IF;

  UPDATE auth.users SET
    email = v_archived,
    email_change = '',
    email_change_token_new = '',
    email_change_token_current = '',
    banned_until = '2999-12-31 00:00:00+00',
    updated_at = now()
  WHERE id = p_user_id;

  UPDATE auth.identities SET
    identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_archived)),
    updated_at = now()
  WHERE user_id = p_user_id AND provider = 'email';

  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  RETURN v_archived;
END;
$$;

REVOKE ALL ON FUNCTION find_account_by_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION archive_account_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION find_account_by_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION archive_account_email(uuid) TO service_role;

-- ============================================================
-- Deactivated = can't sign in
-- ============================================================
CREATE OR REPLACE FUNCTION sync_profile_sign_in_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NEW.is_active THEN
      UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = NEW.id;
    ELSE
      UPDATE auth.users SET banned_until = '2999-12-31 00:00:00+00', updated_at = now() WHERE id = NEW.id;
      DELETE FROM auth.sessions WHERE user_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_sign_in_access ON profiles;
CREATE TRIGGER profiles_sync_sign_in_access AFTER UPDATE OF is_active ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_profile_sign_in_access();

-- Lock out everyone already deactivated or terminated.
UPDATE auth.users u SET banned_until = '2999-12-31 00:00:00+00', updated_at = now()
FROM profiles p
WHERE p.id = u.id AND NOT p.is_active AND u.banned_until IS NULL;

DELETE FROM auth.sessions s USING profiles p WHERE p.id = s.user_id AND NOT p.is_active;
