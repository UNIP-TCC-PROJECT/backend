# Migrations, papéis do banco e reversão

## Papéis (nenhum usa senha padrão; todos vêm do `.env`)

| Papel | Variáveis | Pode | Não pode |
|---|---|---|---|
| admin Postgres | `POSTGRES_ADMIN_*` | administrar o servidor (só o `docker-compose`/DBA usa) | nunca é usado pela aplicação |
| migrator (dono do schema) | `DB_MIGRATOR_*` | DDL: roda as migrations, cria tabelas e gatilhos | não é usado em runtime |
| aplicação (runtime) | `DB_USER` / `DB_PASSWORD` | `SELECT/INSERT/UPDATE/DELETE` nas tabelas comuns; em `audit_logs` só `SELECT/INSERT` | DDL, `TRIGGER`, `TRUNCATE`, desabilitar/remover o gatilho da auditoria, criar extensões |

A aplicação só sobe com `DB_USER`/`DB_PASSWORD`/`DB_NAME` definidos e **nunca** usa `synchronize`.
`AuditService` confere no start que os gatilhos de `audit_logs` existem e **não sobe** se faltarem.

**Limite honesto:** o dono do schema (migrator) e superusuários ainda podem alterar a trilha. A senha do migrator
não deve estar no ambiente da aplicação em produção (rode `migration:run` em passo de deploy separado) e a
âncora externa do `headHash` continua recomendada (RELATORIO-SEGURANCA §4).

## Comandos

```
npm run migration:show      # estado
npm run migration:run       # aplica pendentes (como migrator)
npm run migration:revert    # reverte a ÚLTIMA migration
npm run migration:generate -- src/database/migrations/NomeDaMudanca
```
Depois de `migration:generate`: **revise o SQL** (o gerador grava `"public".` fixo em alguns objetos — remova, as
migrations seguem o `search_path`) e confira que a migration é reversível.

## Banco novo (Docker)
1. `cp .env.example .env` e troque TODAS as `CHANGE_ME_*` por senhas fortes e distintas (o script recusa senhas curtas/padrão).
2. `docker compose up -d` — o init cria os papéis; o container `backend` roda `migration:run` antes de iniciar.

## Banco JÁ existente (criado antes por `synchronize: true`)
Nada é alterado automaticamente. Plano:
1. **Backup**: `pg_dump -Fc` do banco e teste de restauração em outro lugar.
2. Criar os papéis: `docker exec -i <container> sh < docker/postgres/init/01-roles.sh` (variáveis definidas; idempotente).
   Passar a posse dos objetos ao migrator: `psql -U <admin> -d <banco> -v ON_ERROR_STOP=1 -v mig=<DB_MIGRATOR_USER> -f docker/postgres/adopt-existing.sql`
   (escopo só no schema `public`; não usa `REASSIGN OWNED`).
3. Registrar a Baseline como já aplicada **sem executá-la**:
   `INSERT INTO migrations (timestamp, name) VALUES (1793364490083, 'Baseline1793364490083');`
   (crie a tabela `migrations` rodando `npm run migration:show` uma vez.)
4. `npm run migration:run` aplica só a segunda migration (gatilhos + permissões; ela é idempotente com os gatilhos existentes).
5. Apontar a aplicação para `DB_USER` (runtime), reiniciar e conferir `GET /admin/audit-logs/verify`.
6. Rotacionar as credenciais antigas (`postgres`/`postgres`) e remover o acesso externo à porta 5432.

**Verificado** numa cópia (só schema, sem dados) do banco local criado pelo `synchronize` antigo: após os passos 2–4,
`migration:generate` respondeu "No changes" (sem deriva entre o banco adotado e as entidades). Em outro ambiente, repita essa
conferência numa cópia antes de aplicar: se `migration:generate` gerar SQL, há deriva a resolver antes do passo 3.

## Reversão
- `migration:revert` desfaz a última migration. `AuditImmutabilityAndRoles.down()` remove gatilhos e revoga os grants (**tira a imutabilidade — só em manutenção controlada**).
- `Baseline.down()` **apaga todas as tabelas**: só em ambiente descartável. Em produção, a reversão é restaurar o backup do passo 1.
- Rollback do código: versões anteriores à migração dependiam de `synchronize`; ao voltar, use o banco restaurado, não o migrado.
