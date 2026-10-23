import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('favoritos')
@Unique('UQ_favoritos_doador_ong', ['doadorId', 'ongId'])
export class Favorito {
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