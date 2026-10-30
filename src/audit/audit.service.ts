import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

const AUDIT_LOCK = 7245001;
const GENESIS = '0'.repeat(64);
const VERIFY_NOTE = 'A cadeia detecta alteração ou remoção no meio da trilha. Não detecta remoção das últimas linhas sem âncora externa do headHash e não prova que o conteúdo original era verdadeiro.';

type Hashable = Pick<AuditLog, 'actorId' | 'actorType' | 'action' | 'entityType' | 'entityId' | 'organizationId' | 'metadata' | 'ip' | 'createdAt'>;

// JSON canônico (chaves ordenadas): o jsonb do Postgres não preserva a ordem das chaves.
function canonical(v: unknown): string {
  const norm = (x: any): any => (Array.isArray(x) ? x.map(norm) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm(x[k])])) : x);
  return JSON.stringify(norm(JSON.parse(JSON.stringify(v ?? null))));
}

export function chainHash(prevHash: string, r: Hashable): string {
  return createHash('sha256').update(prevHash + '|' + canonical([r.actorId, r.actorType, r.action, r.entityType, r.entityId, r.organizationId, r.metadata, r.ip, new Date(r.createdAt).toISOString()])).digest('hex');
}

export interface AuditActor {
  id: number;
  type: string;
}

export interface AuditEntry {
  actor?: AuditActor | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(
    @InjectRepository(AuditLog) private repo: Repository<AuditLog>,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  // O gatilho de imutabilidade é criado por migration (dono do schema), não pela aplicação. Aqui só conferimos
  // que ele existe: sem ele a trilha deixaria de ser append-only, então falhamos fechado em vez de subir assim.
  async onModuleInit() {
    const table = this.repo.metadata.tableName;
    const rows: { tgname: string }[] = await this.dataSource.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.oid = to_regclass($1) AND NOT t.tgisinternal AND t.tgname IN ('audit_logs_row_guard','audit_logs_truncate_guard')`,
      [this.repo.metadata.tablePath],
    );
    if (rows.length !== 2) {
      throw new Error(`Gatilhos de imutabilidade ausentes em ${table}: rode "npm run migration:run" antes de iniciar a aplicação.`);
    }
  }

  /**
   * Grava o registro encadeado ao anterior. Passe `manager` para gravar na mesma transação da operação auditada.
   * Um lock consultivo serializa as gravações para que a cadeia seja linear.
   */
  async log(entry: AuditEntry, manager?: EntityManager) {
    const run = async (m: EntityManager) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK]);
      const repo = m.getRepository(AuditLog);
      const last = await repo.createQueryBuilder('l').select(['l.id', 'l.hash']).orderBy('l.id', 'DESC').limit(1).getOne();
      const prevHash = last?.hash ?? GENESIS;
      const row = {
        actorId: entry.actor?.id ?? null,
        actorType: entry.actor?.type ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId == null ? null : String(entry.entityId),
        organizationId: entry.organizationId ?? null,
        metadata: (entry.metadata ?? null) as any,
        ip: entry.ip ?? null,
        createdAt: new Date(),
      };
      await repo.insert({ ...row, prevHash, hash: chainHash(prevHash, row) });
    };
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  /**
   * Confere a cadeia inteira. Detecta: linha alterada, linha removida no meio, linha inserida/reordenada.
   * NÃO detecta: remoção das últimas linhas (a cadeia restante continua consistente) nem um atacante que
   * reconstrua a cadeia inteira. Também não prova que o conteúdo registrado era verdadeiro — só que não
   * mudou depois de gravado. Mitigação: ancorar o `headHash` fora do banco (ex.: e-mail/WORM/serviço externo).
   */
  async verify() {
    let checked = 0;
    let prev: string | null = null;
    let afterId = '0';
    for (;;) {
      const rows = await this.repo.createQueryBuilder('l').where('l.id > :afterId', { afterId }).orderBy('l.id', 'ASC').limit(2000).getMany();
      if (!rows.length) break;
      for (const r of rows) {
        afterId = r.id;
        if (!r.hash) continue; // registros anteriores à introdução da cadeia
        if (prev === null) prev = r.prevHash === GENESIS ? GENESIS : r.prevHash; // primeiro elo é o ponto de partida
        const ok = r.prevHash === prev && r.hash === chainHash(r.prevHash!, r);
        if (!ok) return { ok: false, checked, firstBadId: r.id, headHash: null, note: VERIFY_NOTE };
        prev = r.hash;
        checked++;
      }
    }
    return { ok: true, checked, firstBadId: null, headHash: prev, note: VERIFY_NOTE };
  }

  list(filter: {
    entityType?: string;
    organizationId?: string;
    actorId?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.organizationId) where.organizationId = filter.organizationId;
    if (filter.actorId) where.actorId = filter.actorId;
    return this.repo.find({
      where,
      order: { id: 'DESC' },
      take: Math.min(filter.limit ?? 100, 500),
    });
  }
}
