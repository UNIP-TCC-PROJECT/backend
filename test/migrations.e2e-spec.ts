/**
 * Migrations versionadas: aplicação, reversão (down) e falha fechada sem os gatilhos da auditoria.
 * Banco real, schema temporário. Execute:
 *   node node_modules/jest/bin/jest.js --config test/jest-plataforma.json --runInBand -t Migrations
 */
import { DataSource } from 'typeorm';
import { dbOptions } from '../src/database/database.config';
import { AuditService } from '../src/audit/audit.service';
import { AuditLog } from '../src/audit/audit-log.entity';
import { migrateSchema, migratorConn } from './helpers/db';

jest.setTimeout(60000);

describe('Migrations', () => {
  const schema = `teste_migr_${process.pid}_${Date.now()}`;
  let owner: DataSource, ds: DataSource;

  beforeAll(async () => {
    await migrateSchema(schema);
    owner = await migratorConn().initialize();
    ds = await new DataSource({ ...dbOptions('migrator'), schema, extra: { options: `-c search_path=${schema}` } }).initialize();
  });
  afterAll(async () => {
    if (!/^teste_migr_\d+_\d+$/.test(schema)) throw new Error('Schema inválido');
    await ds?.destroy();
    await owner?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await owner?.destroy();
  });

  const count = async (sql: string) => Number((await owner.query(sql, [schema]))[0].n);
  const tables = () => count(`SELECT count(*) n FROM information_schema.tables WHERE table_schema = $1 AND table_name <> 'migrations'`);

  it('o schema criado só por migrations tem as tabelas das entidades e nada a mais para sincronizar', async () => {
    expect(await tables()).toBe(ds.entityMetadatas.filter((m) => m.tableType === 'regular').length);
    // detecta deriva: nenhuma mudança de entidade sem migration correspondente
    const sql = await ds.driver.createSchemaBuilder().log();
    expect(sql.upQueries.map((q) => q.query)).toEqual([]);
  });

  it('o papel da aplicação recebe só o necessário (sem DDL, sem escrita destrutiva em audit_logs)', async () => {
    const role = process.env.DB_USER!;
    const has = async (table: string, priv: string) => (await owner.query(`SELECT has_table_privilege($1, $2, $3) ok`, [role, `"${schema}"."${table}"`, priv]))[0].ok;
    expect(await has('user', 'INSERT')).toBe(true);
    expect(await has('audit_logs', 'INSERT')).toBe(true);
    expect(await has('audit_logs', 'SELECT')).toBe(true);
    for (const p of ['UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']) expect(await has('audit_logs', p)).toBe(false);
    const [{ ok }] = await owner.query(`SELECT has_schema_privilege($1, $2, 'CREATE') ok`, [role, schema]);
    expect(ok).toBe(false);
    expect((await owner.query(`SELECT rolsuper s, rolcreaterole r, rolcreatedb d FROM pg_roles WHERE rolname = $1`, [role]))[0]).toEqual({ s: false, r: false, d: false });
  });

  it('a aplicação falha fechada se os gatilhos da auditoria não existirem', async () => {
    const svc = new AuditService(ds.getRepository(AuditLog), ds);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    await owner.query(`ALTER TABLE "${schema}"."audit_logs" DISABLE TRIGGER audit_logs_row_guard`); // ainda existe (só desabilitado)
    await owner.query(`DROP TRIGGER audit_logs_row_guard ON "${schema}"."audit_logs"`);
    await expect(svc.onModuleInit()).rejects.toThrow(/migration:run/);
  });

  it('down() reverte na ordem inversa e up() reaplica (ida e volta)', async () => {
    await ds.undoLastMigration(); // OrganizationPaymentAccounts
    await ds.undoLastMigration(); // UserCoverImage
    await ds.undoLastMigration(); // PublicacoesTransparencia
    expect(await tables()).toBeGreaterThan(0);
    await ds.undoLastMigration(); // AuditImmutabilityAndRoles
    expect(await count(`SELECT count(*) n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND t.tgname LIKE 'audit_logs_%'`)).toBe(0);
    await ds.undoLastMigration(); // Baseline
    expect(await tables()).toBe(0);
    await ds.runMigrations();
    expect(await tables()).toBeGreaterThan(20);
    const [{ n }] = await owner.query(`SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = $1 AND t.tgname LIKE 'audit_logs_%'`, [schema]);
    expect(n).toBe(2);
  });
});
