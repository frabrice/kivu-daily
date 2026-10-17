-- Live updates on the Money page.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE company_funding; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
