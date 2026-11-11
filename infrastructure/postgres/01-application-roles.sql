\set ON_ERROR_STOP on
\getenv api_db_password API_DB_PASSWORD
\getenv worker_db_password WORKER_DB_PASSWORD

-- The container entrypoint and db-roles service run this as the owner/superuser.
SELECT format('CREATE ROLE repus_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'api_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'repus_api') \gexec
SELECT format('CREATE ROLE repus_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD %L', :'worker_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'repus_worker') \gexec
ALTER ROLE repus_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'api_db_password';
ALTER ROLE repus_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD :'worker_db_password';

SELECT format('GRANT CONNECT ON DATABASE %I TO repus_api, repus_worker', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO repus_api, repus_worker;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM repus_api, repus_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO repus_api, repus_worker;
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM repus_api, repus_worker;
    GRANT SELECT ON TABLE public._prisma_migrations TO repus_worker;
  END IF;
END $$;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM repus_api, repus_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO repus_api, repus_worker;
SELECT format('GRANT USAGE ON TYPE %I.%I TO repus_api, repus_worker', namespace.nspname, type.typname)
FROM pg_catalog.pg_type AS type
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=type.typnamespace
WHERE namespace.nspname='public' AND type.typtype IN ('b','d','e','r','m') AND type.typelem=0 \gexec

-- Prisma migrations run as repus; future application objects receive matching runtime grants.
ALTER DEFAULT PRIVILEGES FOR ROLE repus IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO repus_api;
ALTER DEFAULT PRIVILEGES FOR ROLE repus IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM repus_api, repus_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE repus IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO repus_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE repus IN SCHEMA public
  REVOKE UPDATE ON SEQUENCES FROM repus_api, repus_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE repus IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO repus_api, repus_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE repus IN SCHEMA public
  GRANT USAGE ON TYPES TO repus_api, repus_worker;
