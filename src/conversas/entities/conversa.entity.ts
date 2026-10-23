import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('conversas')
@Unique('UQ_conversas_doador_ong', ['doadorId', 'ongId'])
@Index('IDX_conversas_doador_atualizada', ['doadorId', 'ultimaMensagemEm'])
@Index('IDX_conversas_ong_atualizada', ['ongId', 'ultimaMensagemEm'])
export class Conversa {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  doadorId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doadorId' })
  doador!: User;

  @Column({ type: 'int' })
  ongId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ongId' })
  ong!: User;

  @Column({ type: 'timestamptz', nullable: true })
  ultimaMensagemEm!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
