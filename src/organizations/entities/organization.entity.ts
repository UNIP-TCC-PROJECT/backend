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
  INCOMPLETO = 'INCOMPLETO',
  EM_ANALISE = 'EM_ANALISE',
  AGUARDANDO_DOCUMENTACAO = 'AGUARDANDO_DOCUMENTACAO',
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

  @Column({ type: 'varchar', nullable: true }) email!: string | null;
  @Column({ type: 'varchar', nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 8, nullable: true }) zip!: string | null;
  @Column({ type: 'varchar', nullable: true }) street!: string | null;
  @Column({ type: 'varchar', nullable: true }) number!: string | null;
  @Column({ type: 'varchar', nullable: true }) complement!: string | null;
  @Column({ type: 'varchar', nullable: true }) district!: string | null;
  @Column({ type: 'varchar', nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 2, nullable: true }) state!: string | null;

  // Representante legal e responsável pelo cadastro
  @Column({ type: 'varchar', nullable: true }) legalRepName!: string | null;
  @Column({ type: 'varchar', length: 11, nullable: true }) legalRepCpf!: string | null;
  @Column({ type: 'varchar', nullable: true }) legalRepRole!: string | null;
  @Column({ type: 'varchar', nullable: true }) legalRepEmail!: string | null;
  @Column({ type: 'varchar', nullable: true }) legalRepPhone!: string | null;

  @Column({ type: 'varchar', default: OrganizationStatus.INCOMPLETO })
  status!: OrganizationStatus;

  @Column({ type: 'text', nullable: true })
  statusReason!: string | null;

  @Column({ type: 'int', nullable: true })
  reviewedBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
