import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

@Unique(['ong', 'doador'])
@Entity('reviews')
export class Reviews {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  nota!: number;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  comentario!: string | null;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  ong!: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  doador!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}