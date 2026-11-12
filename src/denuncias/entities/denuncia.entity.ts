import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

export enum DenunciaTipoAlvo {
  ONG = 'ONG',
  DOADOR = 'DOADOR',
  COMENTARIO = 'COMENTARIO',
}

export enum DenunciaStatus {
  PENDENTE = 'PENDENTE',
  EM_ANALISE = 'EM_ANALISE',
  PROCEDENTE = 'PROCEDENTE',
  IMPROCEDENTE = 'IMPROCEDENTE',
}

// Impede duas denúncias pendentes do mesmo autor para o mesmo alvo.
@Index('UQ_denuncia_pendente', ['autorId', 'tipoAlvo', 'alvoId'], {
  unique: true,
  where: `"status" = 'PENDENTE'`,
})
@Entity('denuncias')
export class Denuncia {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  autor!: User;

  @Column()
  autorId!: number;

  @Column({ type: 'enum', enum: DenunciaTipoAlvo })
  tipoAlvo!: DenunciaTipoAlvo;

  // Sem FK: a denúncia deve sobreviver à edição/remoção do alvo.
  @Column()
  alvoId!: number;

  @Column({ type: 'text' })
  motivo!: string;

  // Cópia do alvo no momento da denúncia (nome da ONG, texto/nota do comentário etc.).
  @Column({ type: 'jsonb' })
  contexto!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: DenunciaStatus,
    default: DenunciaStatus.PENDENTE,
  })
  status!: DenunciaStatus;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ type: 'integer', nullable: true })
  reviewedBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
