import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { StoredFile } from '../../common/stored-file.base';
import { Organization } from './organization.entity';

export enum OrganizationDocumentType {
  ESTATUTO = 'ESTATUTO',
  ATA_DIRETORIA = 'ATA_DIRETORIA',
  CARTAO_CNPJ = 'CARTAO_CNPJ',
  CERTIDAO = 'CERTIDAO',
  OUTRO = 'OUTRO',
}

@Entity('organization_documents')
@Index(['organizationId', 'type'])
export class OrganizationDocument extends StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization!: Organization;

  @Column({ type: 'varchar' })
  type!: OrganizationDocumentType;

  // Preenchido quando um novo envio do mesmo tipo substitui este; o histórico é mantido.
  @Column({ type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;
}
