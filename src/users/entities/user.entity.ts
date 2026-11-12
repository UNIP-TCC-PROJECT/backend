
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

  @Column({ default: false })
  contentRestricted!: boolean;

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

  /**
   * Resultado da verificação automática feita no cadastro com os dados públicos do CNPJ.
   * É independente da validação institucional de documentos, usada para conceder a Medalha Branca.
   */
  @Column({ name: 'medalhaVerde', default: false })
  preVerificacaoCnpj!: boolean;

  /** Campo legado de aprovação das solicitações antigas; a Medalha Branca atual é calculada da validação institucional. */
  @Column({ name: 'medalhaBranca', default: false })
  medalhaBrancaLegada!: boolean;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  zip?: string;

  @Column({ nullable: true })
  street?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  district?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  state?: string;

  @Column({ nullable: true })
  bank?: string;

  // Código do banco (lista oficial); nulo quando o banco foi informado como "Outro".
  @Column({ type: 'varchar', length: 3, nullable: true })
  bankCode?: string | null;

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

  // Capa do perfil público da ONG (institucional; sem metadados).
  @Column({ type: 'varchar', length: 500, nullable: true })
  coverImage?: string | null;

  @Column({ nullable: true })
  category?: string;

  @Column({ type: 'varchar', nullable: true })
  asaasCustomerId?: string | null;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil?: Date | null;

  @Column({ default: false })
  mfaEnabled!: boolean;

  @Column({ type: 'text', nullable: true, select: false })
  mfaSecret?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
