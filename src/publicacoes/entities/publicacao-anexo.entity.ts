import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccStatus } from '../../common/accountability-status';
import { StoredFile } from '../../common/stored-file.base';
import { Publicacao } from './publicacao.entity';

export type AnexoKind = 'IMAGEM' | 'DOCUMENTO';

// Arquivo de uma publicação. Só é público quando o admin aprova E marca como publicável.
@Entity('publicacao_anexos')
@Index('IDX_publicacao_anexos_status', ['status'])
export class PublicacaoAnexo extends StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_publicacao_anexos_pub')
  @Column({ type: 'int' })
  publicacaoId!: number;

  @ManyToOne(() => Publicacao, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publicacaoId', foreignKeyConstraintName: 'FK_publicacao_anexos_pub' })
  publicacao!: Publicacao;

  @Column({ type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ type: 'varchar' })
  kind!: AnexoKind;

  // A ONG declara ter autorização das pessoas retratadas / ausência de pessoas identificáveis. Registrada na auditoria.
  @Column({ default: false })
  imageConsent!: boolean;

  @Column({ default: false })
  publishable!: boolean;
}
