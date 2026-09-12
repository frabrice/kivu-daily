/*
# Auto-create profile on auth user creation

The create-user edge function creates the auth.users row via the Admin API
with role/department_id/full_name embedded in user_metadata. This trigger
reads that metadata to insert a complete, constraint-satisfying profiles
row in the same transaction as the auth user insert - avoiding the
employee_requires_department CHECK failing on a bare default insert.
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
