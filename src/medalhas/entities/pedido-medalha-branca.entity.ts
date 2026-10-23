import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum StatusMedalhaBranca {
  NaoSolicitado = 'NaoSolicitado',
  Pendente = 'Pendente',
  Aprovado = 'Aprovado',
  Recusado = 'Recusado',
}

@Entity('medalha_branca_pedido')
@Index('medalha_branca_uma_pendente', ['ongId'], {
  unique: true,
  where: `"status" = 'Pendente'`,
})
export class PedidoMedalhaBranca {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  ongId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ongId' })
  ong!: Relation<User>;

  @Column({ type: 'varchar', default: StatusMedalhaBranca.Pendente })
  status!: StatusMedalhaBranca;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'text', nullable: true })
  motivo!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  analisadoEm!: Date | null;

  @Column({ type: 'int', nullable: true })
  analisadoPor!: number | null;
}

@Entity('medalha_branca_documento')
export class DocumentoMedalhaBranca {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  solicitacaoId!: number;

  @ManyToOne(() => PedidoMedalhaBranca, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'solicitacaoId' })
  solicitacao!: Relation<PedidoMedalhaBranca>;

  @Column()
  nome!: string;

  @Column()
  tipo!: string;

  @Column()
  tamanho!: number;

  // Conteúdo privado: não participa de listagens e não usa a pasta de avatares.
  @Column({ type: 'bytea', select: false })
  conteudo!: Buffer;
}
