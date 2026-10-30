import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Organization } from './organization.entity';

export enum CheckSource {
  BRASILAPI = 'BRASILAPI',
  MAPA_OSC = 'MAPA_OSC',
  PORTAL_TRANSPARENCIA = 'PORTAL_TRANSPARENCIA',
  TRANSFEREGOV = 'TRANSFEREGOV',
}

// OK = consultou e nada a destacar; ALERTA = exige atenção do analista;
// NAO_ENCONTRADO = ausência na base (neutro, não indica irregularidade);
// INDISPONIVEL = falha/timeout/sem credencial (a decisão fica com o analista).
export enum CheckStatus {
  OK = 'OK',
  ALERTA = 'ALERTA',
  NAO_ENCONTRADO = 'NAO_ENCONTRADO',
  INDISPONIVEL = 'INDISPONIVEL',
}

// Cada consulta externa é um registro imutável com fonte e data (histórico completo).
@Entity('organization_external_checks')
@Index(['organizationId', 'source', 'queriedAt'])
export class OrganizationExternalCheck {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization!: Organization;

  @Column({ type: 'varchar' })
  source!: CheckSource;

  @Column({ type: 'varchar' })
  status!: CheckStatus;

  @Column({ type: 'text' })
  summary!: string;

  // Divergências/alertas legíveis para o analista.
  @Column({ type: 'jsonb', default: () => `'[]'` })
  findings!: string[];

  // Resposta resumida da fonte (sem credenciais).
  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  httpStatus!: number | null;

  @Column({ type: 'int', nullable: true })
  triggeredBy!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  queriedAt!: Date;
}
