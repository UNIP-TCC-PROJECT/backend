import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum OrganizationStatus {
  RASCUNHO = 'RASCUNHO',
  EM_ANALISE = 'EM_ANALISE',
  APROVADA = 'APROVADA',
  REPROVADA = 'REPROVADA',
  SUSPENSA = 'SUSPENSA',
}

// Dono do isolamento multi-ONG: toda tabela filha carrega organizationId.
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', unique: true })
  ownerId!: number;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @Column({ length: 14, unique: true })
  cnpj!: string;

  @Column()
  legalName!: string;

  @Column({ type: 'varchar', nullable: true })
  tradeName!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', default: OrganizationStatus.RASCUNHO })
  status!: OrganizationStatus;

  @Column({ type: 'text', nullable: true })
  statusReason!: string | null;

  @Column({ type: 'int', nullable: true })
  reviewedBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
