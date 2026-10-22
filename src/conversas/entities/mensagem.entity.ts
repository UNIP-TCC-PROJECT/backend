import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Conversa } from './conversa.entity';

@Entity('mensagens')
@Index('IDX_mensagens_conversa_data', ['conversaId', 'createdAt'])
export class Mensagem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  conversaId!: number;

  @ManyToOne(() => Conversa, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversaId' })
  conversa!: Conversa;

  @Column({ type: 'int' })
  remetenteId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'remetenteId' })
  remetente!: User;

  @Column({ type: 'text' })
  texto!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
