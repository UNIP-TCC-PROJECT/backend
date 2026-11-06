import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
@Index(['entityType', 'entityId'])
@Index(['organizationId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'int', nullable: true })
  actorId!: number | null;

  @Column({ type: 'varchar', nullable: true })
  actorType!: string | null;

  @Column()
  action!: string;

  @Column()
  entityType!: string;

  @Column({ type: 'varchar', nullable: true })
  entityId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  organizationId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  // Encadeamento: hash = SHA-256(prevHash + conteúdo canônico). Ajuda a DETECTAR alterações/remoções no meio da
  // trilha; não prova que o conteúdo original era verdadeiro (ver AuditService.verify).
  @Column({ type: 'varchar', length: 64, nullable: true })
  prevHash!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hash!: string | null;
}
