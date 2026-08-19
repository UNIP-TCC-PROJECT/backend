import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, } from 'typeorm';

import { User } from '../../users/entities/user.entity';


@Entity('reviews')
export class Reviews {
    @PrimaryGeneratedColumn()
  id!: number;
  
  @Column({ type: 'int' })
  nota!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  ong!: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  doador!: User;

  @CreateDateColumn()
  createdAt!: Date;
}
