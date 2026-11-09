/**
 * Validação institucional que habilita a Medalha Branca.
 *
 * Função pura e independente do nível de transparência: responde apenas "esta instituição passou pela
 * validação institucional e continua atendendo aos requisitos?". É sempre calculada de registros reais
 * (nunca armazenada), então muda sozinha se a organização for suspensa ou um documento sair da aprovação.
 * Não é garantia de idoneidade nem de uso correto dos recursos.
 */
import { OrganizationStatus } from './entities/organization.entity';

export const REGISTRATION_RULES_VERSION = '1';

export interface RegistrationInput {
  status: OrganizationStatus | null;
  /** Há consulta cadastral (Receita) registrada com dados. */
  hasCadastralCheck: boolean;
  requiredDocuments: { type: string; approved: boolean }[];
  /** Data da última aprovação institucional (registro de auditoria). */
  approvedAt: Date | null;
  /** Data da consulta cadastral mais recente. */
  checkedAt: Date | null;
  /** A aprovação foi manual, apesar de divergência/indisponibilidade nas consultas (há justificativa registrada). */
  approvedWithReservations: boolean;
}

export interface RegistrationResult {
  verified: boolean;
  validatedAt: string | null;
  checkedAt: string | null;
  /** Aprovação administrativa com ressalvas: o motivo fica só no registro interno de auditoria. */
  withReservations: boolean;
  criteria: { label: string; met: boolean }[];
  rulesVersion: string;
}

export function evaluateRegistration(i: RegistrationInput): RegistrationResult {
  const approved = i.status === OrganizationStatus.APROVADA;
  const docsOk = i.requiredDocuments.length > 0 && i.requiredDocuments.every((d) => d.approved);
  const criteria = [
    { label: 'Instituição aprovada na validação institucional da plataforma', met: approved },
    { label: 'Consulta cadastral na Receita Federal registrada', met: i.hasCadastralCheck },
    { label: 'Documentos obrigatórios analisados e aprovados', met: docsOk },
  ];
  const verified = criteria.every((c) => c.met);
  return {
    verified,
    validatedAt: verified ? (i.approvedAt?.toISOString() ?? null) : null,
    checkedAt: verified ? (i.checkedAt?.toISOString() ?? null) : null,
    withReservations: verified && i.approvedWithReservations,
    criteria: verified ? criteria : [],
    rulesVersion: REGISTRATION_RULES_VERSION,
  };
}
