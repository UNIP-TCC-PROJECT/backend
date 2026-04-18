import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum UserType {
  ONG = 'ONG',
  DOADOR = 'DOADOR',
}

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({
    type: 'enum',
    enum: UserType,
  })
  type!: UserType;
}
