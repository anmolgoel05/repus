-- Full backups include migration history; the trusted backup/worker role may read it only.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='repus_worker') THEN
    GRANT SELECT ON TABLE public._prisma_migrations TO repus_worker;
  END IF;
END $$;
