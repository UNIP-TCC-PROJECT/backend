import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

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

  // Trilha append-only: o próprio banco rejeita UPDATE/DELETE/TRUNCATE, mesmo via SQL direto da aplicação.
  async onModuleInit() {
    await this.dataSource.query(`
      CREATE OR REPLACE FUNCTION audit_logs_imutavel() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit_logs é imutável'; END; $$ LANGUAGE plpgsql`);
    const table = this.repo.metadata.tablePath
      .split('.')
      .map((p) => `"${p}"`)
      .join('.');
    await this.dataSource.query(
      `DROP TRIGGER IF EXISTS audit_logs_row_guard ON ${table}`,
    );
    await this.dataSource.query(`
      CREATE TRIGGER audit_logs_row_guard BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION audit_logs_imutavel()`);
    await this.dataSource.query(
      `DROP TRIGGER IF EXISTS audit_logs_truncate_guard ON ${table}`,
    );
    await this.dataSource.query(`
      CREATE TRIGGER audit_logs_truncate_guard BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_imutavel()`);
  }

  /** Passe `manager` para gravar na mesma transação da operação auditada. */
  async log(entry: AuditEntry, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    await repo.insert({
      actorId: entry.actor?.id ?? null,
      actorType: entry.actor?.type ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      organizationId: entry.organizationId ?? null,
      metadata: (entry.metadata ?? null) as any,
      ip: entry.ip ?? null,
    });
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
