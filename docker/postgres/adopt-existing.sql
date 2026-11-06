-- Adoção de um banco que já existia (criado por synchronize): passa a posse dos objetos do schema public
-- ao papel migrator. Rode como admin, DEPOIS de 01-roles.sh e DEPOIS de um backup:
--   psql -U <admin> -d <banco> -v ON_ERROR_STOP=1 -v mig=<DB_MIGRATOR_USER> -f docker/postgres/adopt-existing.sql
-- Escopo restrito ao schema public (não usa REASSIGN OWNED, que arrastaria objetos do superusuário).
SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'mig') FROM pg_tables WHERE schemaname = 'public' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', sequence_schema, sequence_name, :'mig') FROM information_schema.sequences WHERE sequence_schema = 'public' \gexec
SELECT format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, :'mig') FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e' \gexec
SELECT format('ALTER FUNCTION %s OWNER TO %I', p.oid::regprocedure, :'mig') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'mig') \gexec
