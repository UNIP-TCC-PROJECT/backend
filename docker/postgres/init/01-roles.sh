#!/bin/sh
# Cria os papéis separados do banco. Roda no primeiro start do volume (docker-entrypoint-initdb.d) e também
# pode ser executado à mão contra um banco existente (ver docs/MIGRATIONS.md). É idempotente.
#   admin (POSTGRES_USER)  → superusuário: só administração, nunca usado pela aplicação
#   DB_MIGRATOR_USER       → dono do banco/schema: roda migrations (DDL)
#   DB_USER                → aplicação: sem DDL; em audit_logs só SELECT/INSERT (concedido pela migration)
set -eu

for v in POSTGRES_USER POSTGRES_DB DB_USER DB_PASSWORD DB_MIGRATOR_USER DB_MIGRATOR_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "ERRO: variável $v ausente" >&2; exit 1; }
done
for v in DB_PASSWORD DB_MIGRATOR_PASSWORD POSTGRES_PASSWORD; do
  eval "val=\${$v:-}"
  case "$val" in
    *CHANGE_ME*|*changeme*|*postgres*|*password*|*senha*) echo "ERRO: $v parece senha padrão/de exemplo" >&2; exit 1;;
  esac
  [ "${#val}" -ge 16 ] || { echo "ERRO: $v precisa ter ao menos 16 caracteres" >&2; exit 1; }
done
[ "$DB_USER" != "$DB_MIGRATOR_USER" ] && [ "$DB_USER" != "$POSTGRES_USER" ] && [ "$DB_MIGRATOR_USER" != "$POSTGRES_USER" ] \
  || { echo "ERRO: os três usuários (admin, migrator, app) precisam ser diferentes" >&2; exit 1; }
[ "$DB_PASSWORD" != "$DB_MIGRATOR_PASSWORD" ] || { echo "ERRO: senhas de app e migrator precisam ser diferentes" >&2; exit 1; }

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" -v mig="$DB_MIGRATOR_USER" -v mig_pw="$DB_MIGRATOR_PASSWORD" -v app="$DB_USER" -v app_pw="$DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'mig')
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'mig') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'app')
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'mig', :'mig_pw') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app', :'app_pw') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', :'db', :'mig', :'app') \gexec
-- O migrator é dono do banco (e, via pg_database_owner, do schema public): é quem cria tabelas e gatilhos.
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'mig') \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
echo "Papéis criados/atualizados: migrator=$DB_MIGRATOR_USER app=$DB_USER"
