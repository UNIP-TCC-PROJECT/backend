import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { join } from 'node:path';
import { ENTITIES } from './entities';

export type DbRole = 'runtime' | 'migrator';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name} (sem valor padrão por segurança)`);
  return v;
}

/**
 * Opções de conexão. Sem credenciais padrão: a aplicação não sobe sem DB_USER/DB_PASSWORD.
 *  - runtime  → DB_USER/DB_PASSWORD (papel sem DDL e sem UPDATE/DELETE em audit_logs);
 *  - migrator → DB_MIGRATOR_USER/DB_MIGRATOR_PASSWORD (dono do schema; só a CLI de migrations usa).
 * `synchronize` é sempre false: o schema só muda por migration versionada.
 */
export function dbOptions(role: DbRole = 'runtime', env: NodeJS.ProcessEnv = process.env): PostgresConnectionOptions {
  const [u, p] = role === 'migrator' ? ['DB_MIGRATOR_USER', 'DB_MIGRATOR_PASSWORD'] : ['DB_USER', 'DB_PASSWORD'];
  return {
    type: 'postgres',
    host: env.DB_HOST ?? 'localhost',
    port: parseInt(env.DB_PORT ?? '5432', 10),
    username: required(env, u),
    password: required(env, p),
    database: required(env, 'DB_NAME'),
    entities: ENTITIES,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    installExtensions: false, // a extensão uuid-ossp é criada pela migration Baseline (o papel de runtime não cria extensões)
    migrationsRun: false,
    migrationsTransactionMode: 'each',
  };
}
