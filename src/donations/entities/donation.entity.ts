import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../common/bigint.transformer';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { User } from '../../users/entities/user.entity';

export enum DonationStatus {
  PENDENTE = 'PENDENTE',
  CONFIRMADA = 'CONFIRMADA',
  CANCELADA = 'CANCELADA',
}

@Entity('donations')
@Index(['campaignId', 'status'])
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

  @CreateDateColumn()
  createdAt!: Date;
}
