-- Live updates on the Company plan pages.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE company_budgets; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE company_priorities; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
