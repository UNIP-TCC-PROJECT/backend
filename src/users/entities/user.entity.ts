
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

export enum UserStatus {
  ATIVO = 'ATIVO',
  SUSPENSO = 'SUSPENSO',
  BANIDO = 'BANIDO',
}

@Entity()
export class User { 
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({
  type: 'enum',
  enum: UserStatus,
  default: UserStatus.ATIVO,
})
status!: UserStatus;

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

  @Column({ default: false })
  medalhaVerde!: boolean;

  @Column({ default: false })
  medalhaBranca!: boolean;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  zip?: string;

  @Column({ nullable: true })
  street?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  state?: string;

  @Column({ nullable: true })
  bank?: string;

  @Column({ nullable: true })
  agency?: string;

  @Column({ nullable: true })
  account?: string;

  @Column({ nullable: true })
  accountType?: string;

  @Column({ nullable: true })
  legalName?: string;

  @Column({ nullable: true })
  legalCpf?: string;

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
