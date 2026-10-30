import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccStatus } from '../../common/accountability-status';
import { bigintTransformer } from '../../common/bigint.transformer';
import { StoredFile } from '../../common/stored-file.base';
import { Campaign } from '../../campaigns/entities/campaign.entity';

export enum ExpenseDocumentKind {
  NOTA_FISCAL = 'NOTA_FISCAL',
  RECIBO = 'RECIBO',
  COMPROVANTE_PAGAMENTO = 'COMPROVANTE_PAGAMENTO',
  OUTRO = 'OUTRO',
}

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

  @Column({ type: 'varchar', length: 160, nullable: true })
  supplier!: string | null;

  // CPF/CNPJ do fornecedor: uso interno, nunca é exposto publicamente.
  @Column({ type: 'varchar', length: 14, nullable: true })
  supplierDocument!: string | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountCents!: number;

  @Column({ type: 'date' })
  spentAt!: string;

  @Column({ type: 'varchar', default: AccStatus.ENVIADA })
  status!: AccStatus;

  @Column({ type: 'int', nullable: true })
  reviewedBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
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

  @Column({ type: 'varchar', default: ExpenseDocumentKind.OUTRO })
  kind!: ExpenseDocumentKind;

  // Só o administrador marca como publicável, depois de conferir que não há dados pessoais.
  @Column({ default: false })
  publishable!: boolean;
}
