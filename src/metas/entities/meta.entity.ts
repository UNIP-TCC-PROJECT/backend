import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

export enum MetaType {
  FINANCEIRA = 'FINANCEIRA',
  MATERIAL = 'MATERIAL',
  VOLUNTARIADO = 'VOLUNTARIADO',
}

export enum MetaPriority {
  BAIXA = 'BAIXA',
  MEDIA = 'MEDIA',
  ALTA = 'ALTA',
}

@Entity()
export class Meta {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: MetaType,
  })
  type!: MetaType;

  // Usado para metas financeiras
  @Column('decimal', {
    precision: 10,
    scale: 2,
    nullable: true,
  })
  targetAmount?: number;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
  })
  currentAmount!: number;

  // Usado para metas materiais e de voluntariado
  @Column({ nullable: true })
  targetQuantity?: number;

  @Column({ default: 0 })
  currentQuantity!: number;

  @Column({ nullable: true })
  unit?: string;

  @Column({ type: 'date', nullable: true })
  deadline?: Date;

  @Column({ default: true })
  active!: boolean;

    @Column({
    type: 'enum',
    enum: MetaPriority,
    default: MetaPriority.MEDIA,
  })
  priority!: MetaPriority;

    @Column({ nullable: true })
  details?: string;

  @Column({ nullable: true })
  image?: string;

  // ONG dona da meta
  @ManyToOne(() => User)
  @JoinColumn({ name: 'ongId' })
  ong!: User;

  @Column()
  ongId!: number;
}