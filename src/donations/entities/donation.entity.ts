import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../common/bigint.transformer';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { User } from '../../users/entities/user.entity';

export enum DonationStatus {
  PENDENTE = 'PENDENTE',
  CONFIRMADA = 'CONFIRMADA',
  CANCELADA = 'CANCELADA',
  ESTORNADA = 'ESTORNADA',
}

@Entity('donations')
@Index(['campaignId', 'status'])
@Index(['donorId', 'idempotencyKey'], { unique: true })
export class Donation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  @Index()
  @Column({ type: 'int' })
  donorId!: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'donorId' })
  donor!: User;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountCents!: number;

  @Column({ type: 'varchar', default: DonationStatus.PENDENTE })
  status!: DonationStatus;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt!: Date | null;

  @Column({ type: 'varchar', default: 'ASAAS' })
  provider!: string;

  // Id da cobrança no Asaas (pay_...). Único: uma cobrança nunca vira duas doações.
  @Column({ type: 'varchar', unique: true, nullable: true })
  providerPaymentId!: string | null;

  // Chave enviada pelo cliente para que repetir o POST não gere nova cobrança.
  @Column({ type: 'varchar', length: 80, nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'text', nullable: true })
  pixPayload!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pixExpiresAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
