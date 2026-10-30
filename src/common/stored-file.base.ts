import { Column, CreateDateColumn } from 'typeorm';

export enum ReviewStatus {
  PENDENTE = 'PENDENTE',
  APROVADO = 'APROVADO',
  REPROVADO = 'REPROVADO',
}

// Colunas comuns a todo arquivo enviado (documentos, comprovantes, evidências).
export abstract class StoredFile {
  @Column()
  name!: string;

  @Column()
  mime!: string;

  @Column({ type: 'int' })
  size!: number;

  @Column({ length: 64 })
  sha256!: string;

  @Column({ type: 'bytea', select: false })
  content!: Buffer;

  @Column({ type: 'varchar', default: ReviewStatus.PENDENTE })
  status!: ReviewStatus;

  @Column({ type: 'int' })
  uploadedBy!: number;

  @Column({ type: 'int', nullable: true })
  reviewedBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
