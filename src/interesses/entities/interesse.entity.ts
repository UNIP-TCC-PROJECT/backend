import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('interesses')
@Unique('UQ_interesses_doador_ong', ['doadorId', 'ongId'])
@Index('IDX_interesses_ong_doador', ['ongId', 'doadorId'])
export class Interesse {
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
