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

@Entity('sac_conversas')
@Index('UQ_sac_conversas_usuario', ['usuarioId'], { unique: true })
export class ConversaSac {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  usuarioId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuarioId' })
  usuario!: User;

  @Column({ type: 'timestamptz', nullable: true })
  ultimaMensagemEm!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
