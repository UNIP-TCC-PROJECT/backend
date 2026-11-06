import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

export enum PaymentAccountStatus {
  /** Reservada no banco; a chamada ao provedor está em andamento (ou foi interrompida). */
  CRIANDO = 'CRIANDO',
  /** Subconta criada no provedor, ainda em análise cadastral. Não recebe doações. */
  AGUARDANDO_APROVACAO = 'AGUARDANDO_APROVACAO',
  /** Aprovada pelo provedor. Única situação em que cobranças podem ser criadas. */
  ATIVA = 'ATIVA',
  REJEITADA = 'REJEITADA',
  /** O provedor recusou a credencial ou bloqueou a conta. */
  BLOQUEADA = 'BLOQUEADA',
  /** A criação falhou. Reexecutável só se nada chegou a ser criado no provedor. */
  FALHA = 'FALHA',
}

/**
 * Subconta de pagamento (Asaas) de uma ONG. Uma por organização (unique), e o provedor identifica
 * a conta por `providerAccountId`/`walletId`, também únicos: uma subconta nunca serve a duas ONGs.
 * A chave de API fica cifrada (AES-256-GCM, amarrada ao id da organização) e nunca sai do backend.
 */
@Entity('organization_payment_accounts')
@Index('IDX_org_payment_accounts_org', ['organizationId'], { unique: true })
export class OrganizationPaymentAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ManyToOne + índice único explícito: a unicidade (uma subconta por ONG) vem do índice, com nome estável.
  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId', foreignKeyConstraintName: 'FK_org_payment_accounts_organization' })
  organization!: Organization;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', default: 'ASAAS' })
  provider!: string;

  /** 'sandbox' | 'production': uma credencial de um ambiente nunca é usada no outro. */
  @Column({ type: 'varchar', length: 12 })
  environment!: string;

  @Index('IDX_org_payment_accounts_provider_account', { unique: true })
  @Column({ type: 'varchar', nullable: true })
  providerAccountId!: string | null;

  @Index('IDX_org_payment_accounts_wallet', { unique: true })
  @Column({ type: 'varchar', nullable: true })
  walletId!: string | null;

  /** Chave de API da subconta, cifrada. Nunca serializada em resposta. */
  @Column({ type: 'text', nullable: true, select: false })
  apiKeyEnc!: string | null;

  @Column({ type: 'varchar', default: PaymentAccountStatus.CRIANDO })
  status!: PaymentAccountStatus;

  /** Último status cadastral devolvido pelo provedor (geral, dados comerciais, bancários, documentos). */
  @Column({ type: 'jsonb', nullable: true })
  providerStatus!: Record<string, string> | null;

  /** Motivo legível (falha, rejeição, bloqueio). Só administradores veem. */
  @Column({ type: 'text', nullable: true })
  statusDetail!: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
