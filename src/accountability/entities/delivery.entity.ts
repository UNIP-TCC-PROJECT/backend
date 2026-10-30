import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { StoredFile } from '../../common/stored-file.base';
import { Campaign } from '../../campaigns/entities/campaign.entity';

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

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'int', nullable: true })
  quantity!: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  unit!: string | null;

  @Column({ type: 'date' })
  deliveredAt!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('delivery_evidences')
export class DeliveryEvidence extends StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'uuid' })
  deliveryRecordId!: string;

  @ManyToOne(() => DeliveryRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deliveryRecordId' })
  deliveryRecord!: DeliveryRecord;
}
