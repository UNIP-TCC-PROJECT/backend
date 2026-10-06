import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum UserType {
  ONG = 'ONG',
  DOADOR = 'DOADOR',
  ADMIN = 'ADMIN',
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

  @Column({ nullable: true })
  cpf?: string;

  @Column({ nullable: true })
  cnpj?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  averageRating?: number;

  @Column({ type: 'int', default: 0 })
  totalReviews?: number;

  @Column({ nullable: true })
  whatsapp?: string;

  @Column({ nullable: true })
  instagram?: string;

  @Column({ nullable: true })
  website?: string;

  @Column({ nullable: true })
  pixKey?: string;

  @Column({ nullable: true })
  profileImage?: string;

  @Column({ nullable: true })
  category?: string;

  @CreateDateColumn()
  createdAt!: Date;
}