import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { StoredFile } from '../../common/stored-file.base';
import { Campaign } from '../../campaigns/entities/campaign.entity';

export enum EvidenceKind {
  FOTO_COMPRA = 'FOTO_COMPRA',
  FOTO_PRODUTO = 'FOTO_PRODUTO',
  FOTO_ACAO = 'FOTO_ACAO',
  FOTO_ENTREGA = 'FOTO_ENTREGA',
  RELATORIO = 'RELATORIO',
}

@Entity('delivery_records')
@Index(['organizationId', 'campaignId'])
export class DeliveryRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  // Despesa que originou a compra (rastreabilidade), opcional.
  @Column({ type: 'uuid', nullable: true })
  expenseId!: string | null;

  // O que foi adquirido
  @Column({ type: 'varchar', length: 255 })
  itemDescription!: string;

  @Column({ type: 'int' })
  quantityPurchased!: number;

  @Column({ type: 'int' })
  quantityDistributed!: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  unit!: string | null;

  // Atividade realizada (texto público após aprovação de evidência: não inclua dados de beneficiários).
  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'date' })
  deliveredAt!: string;

  // Região/município/bairro — público. O detalhe do local fica restrito à ONG e à análise.
  @Column({ type: 'varchar', length: 120 })
  region!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  locationDetail!: string | null;

  @Column({ type: 'varchar', length: 160 })
  responsibleName!: string;

  @Column({ type: 'int' })
  registeredBy!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('delivery_evidences')
@Index(['organizationId', 'status'])
export class DeliveryEvidence extends StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  // Vínculo: registro de entrega e/ou campanha (ao menos um).
  @Column({ type: 'uuid', nullable: true })
  deliveryRecordId!: string | null;

  @ManyToOne(() => DeliveryRecord, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'deliveryRecordId' })
  deliveryRecord!: DeliveryRecord | null;

  @Column({ type: 'uuid', nullable: true })
  campaignId!: string | null;

  @Column({ type: 'varchar' })
  kind!: EvidenceKind;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'date' })
  takenAt!: string;

  @Column({ type: 'varchar', length: 160 })
  responsibleName!: string;

  @Column({ default: false })
  publishable!: boolean;
}
