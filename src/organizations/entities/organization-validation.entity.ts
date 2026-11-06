import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Organization } from './organization.entity';

// Histórico imutável de decisões institucionais (manual agora; fontes externas na etapa de integrações).
@Entity('organization_validations')
@Index(['organizationId', 'createdAt'])
export class OrganizationValidation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization!: Organization;

  @Column({ default: 'MANUAL' })
  source!: string;

  @Column()
  decision!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'int', nullable: true })
  reviewedBy!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
