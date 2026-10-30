import { DataSource } from 'typeorm';
import { dbOptions } from '../../src/database/database.config';

/**
 * Infra de teste de banco. Exige as mesmas variáveis de produção (sem usuário/senha padrão):
 *  - bootstrap/migrations/"atacante com acesso ao banco" → papel migrator (dono do schema);
 *  - a aplicação sob teste → papel runtime (DB_USER), o mesmo restrito de produção.
 * Cada suíte usa um schema temporário descartável.
 */
export const migratorConn = () => new DataSource({ ...dbOptions('migrator'), entities: [], migrations: [] });

/** Aplica as migrations REAIS no schema temporário (nada de synchronize). */
export async function migrateSchema(schema: string) {
  const owner = await migratorConn().initialize();
  await owner.query(`CREATE SCHEMA "${schema}"`);
  await owner.destroy();
  // search_path explícito: o SQL cru das migrations não passa pela opção `schema` do TypeORM.
  const ds = await new DataSource({ ...dbOptions('migrator'), schema, extra: { options: `-c search_path=${schema}` } }).initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}

/** Opções do TypeORM para a aplicação (papel runtime) apontando para o schema temporário. */
export const runtimeOptions = (schema: string) => ({ ...dbOptions('runtime'), schema, extra: { options: `-c search_path=${schema}` }, entities: undefined as any });
