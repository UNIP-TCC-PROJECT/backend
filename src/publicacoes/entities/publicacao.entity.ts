import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { Expense } from '../../accountability/entities/expense.entity';
import { DeliveryRecord } from '../../accountability/entities/delivery.entity';
import { ContentReviewStatus } from '../../common/content-moderation';

@Entity('publicacoes')
@Index(['ongId', 'createdAt', 'id'])
@Index('IDX_publicacoes_org_created', ['organizationId', 'createdAt'])
export class Publicacao {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  description!: string;

  // Legado: posts antigos guardam a imagem no disco. Novos posts usam publicacao_anexos (analisados pelo admin).
  @Column({ type: 'varchar', length: 500, nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'uuid', nullable: true })
  organizationId!: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId', foreignKeyConstraintName: 'FK_publicacoes_organization' })
  organization!: Organization | null;

  @Column({ type: 'varchar', length: 30, default: 'ATUALIZACAO' })
  category!: string;

  // Vínculos opcionais com registros reais da prestação de contas (validados no backend).
  @Column({ type: 'uuid', nullable: true })
  campaignId!: string | null;

  @ManyToOne(() => Campaign, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaignId', foreignKeyConstraintName: 'FK_publicacoes_campaign' })
  campaign!: Campaign | null;

  @Index('IDX_publicacoes_expense')
  @Column({ type: 'uuid', nullable: true })
  expenseId!: string | null;

  @ManyToOne(() => Expense, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'expenseId', foreignKeyConstraintName: 'FK_publicacoes_expense' })
  expense!: Expense | null;

  @Index('IDX_publicacoes_delivery')
  @Column({ type: 'uuid', nullable: true })
  deliveryRecordId!: string | null;

  @ManyToOne(() => DeliveryRecord, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deliveryRecordId', foreignKeyConstraintName: 'FK_publicacoes_delivery' })
  deliveryRecord!: DeliveryRecord | null;

  @Column({ type: 'int' })
  ongId!: number;

  @Column({ type: 'varchar', default: ContentReviewStatus.APROVADA })
  reviewStatus!: ContentReviewStatus;

  @Column({ type: 'text', nullable: true })
  reviewReason!: string | null;

  @Column({ type: 'int', nullable: true })
  reviewedBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'ongId' })
  ong!: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
