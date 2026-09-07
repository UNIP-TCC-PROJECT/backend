import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum MedalhaStatus {
  PENDENTE = 'PENDENTE',
  APROVADA = 'APROVADA',
  RECUSADA = 'RECUSADA',
}

@Entity()
export class Medalha {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  ongId!: number;

  @Column({
    type: 'enum',
    enum: MedalhaStatus,
    default: MedalhaStatus.PENDENTE,
  })
  status!: MedalhaStatus;

  @CreateDateColumn()
  createdAt!: Date;
}