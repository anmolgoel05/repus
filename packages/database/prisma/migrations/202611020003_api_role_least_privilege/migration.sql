-- RLS does not constrain TRUNCATE. Runtime API access must remain DML-only.
-- Deployments using the standard application role also keep migration history owner-only.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='repus_api') THEN
    REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM repus_api;
    REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM repus_api;
  END IF;
END $$;
