import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../common/bigint.transformer';
import { Organization } from '../../organizations/entities/organization.entity';

export enum CampaignStatus {
  RASCUNHO = 'RASCUNHO',
  ATIVA = 'ATIVA',
  ENCERRADA = 'ENCERRADA',
  SUSPENSA = 'SUSPENSA',
}

@Entity('campaigns')
@Index(['organizationId', 'status'])
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId' })
  organization!: Organization;

  @Column({ length: 160 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  goalCents!: number;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'varchar', default: CampaignStatus.RASCUNHO })
  status!: CampaignStatus;

  @Column({ type: 'text', nullable: true })
  statusReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
