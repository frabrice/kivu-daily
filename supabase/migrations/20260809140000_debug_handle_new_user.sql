CREATE TABLE IF NOT EXISTS _debug_log (
  id serial PRIMARY KEY,
  message text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  BEGIN
    INSERT INTO profiles (id, full_name, email, role, department_id, force_password_change)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'role', 'employee'),
      NULLIF(NEW.raw_user_meta_data->>'department_id', '')::uuid,
      true
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _debug_log (message) VALUES ('handle_new_user error: ' || SQLERRM || ' | detail: ' || SQLSTATE);
    RAISE;
  END;
  RETURN NEW;
END;
$$;
