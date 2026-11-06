import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Todo evento recebido do gateway, na íntegra. O id do evento é único: reenvios não reprocessam.
@Entity('payment_events')
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column()
  providerEventId!: string;

  @Column({ default: 'ASAAS' })
  provider!: string;

  @Column()
  event!: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  providerPaymentId!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  // Resultado do processamento: APPLIED, NO_CHANGE, IGNORED_*, REJECTED_* ou ERROR.
  @Column({ type: 'varchar', nullable: true })
  outcome!: string | null;
}
