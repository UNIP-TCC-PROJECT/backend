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
import { ConversaSac } from './conversa-sac.entity';

@Entity('sac_mensagens')
@Index('IDX_sac_mensagens_conversa_data', ['conversaId', 'createdAt'])
export class MensagemSac {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  conversaId!: number;

  @ManyToOne(() => ConversaSac, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversaId' })
  conversa!: ConversaSac;

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
