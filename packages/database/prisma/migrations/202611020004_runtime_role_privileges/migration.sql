-- Background processing needs cross-tenant DML, not schema or migration-history privileges.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='repus_api') THEN
    REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM repus_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='repus_worker') THEN
    REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM repus_worker;
    REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM repus_worker;
    REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM repus_worker;
  END IF;
END $$;
