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
}
