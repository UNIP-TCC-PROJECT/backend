import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../common/bigint.transformer';
import { ReviewStatus, StoredFile } from '../../common/stored-file.base';
import { Campaign } from '../../campaigns/entities/campaign.entity';

@Entity('expenses')
@Index(['organizationId', 'status'])
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Denormalizado de campaigns.organizationId para filtrar isolamento sem join.
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  @Column({ length: 255 })
  description!: string;

  @Column({ length: 60 })
  category!: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountCents!: number;

  @Column({ type: 'date' })
  spentAt!: string;

  @Column({ type: 'varchar', default: ReviewStatus.PENDENTE })
  status!: ReviewStatus;

  @Column({ type: 'int', nullable: true })
  reviewedBy!: number | null;

  @Column({ type: 'text', nullable: true })
  reviewReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('expense_documents')
export class ExpenseDocument extends StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'uuid' })
  expenseId!: string;

  @ManyToOne(() => Expense, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'expenseId' })
  expense!: Expense;
}
