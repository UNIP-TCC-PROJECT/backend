import { PedidoMedalhaBranca, DocumentoMedalhaBranca } from '../medalhas/entities/pedido-medalha-branca.entity';
import { User } from '../users/entities/user.entity';
import { Favorito } from '../favoritos/entities/favorito.entity';
import { Reviews } from '../reviews/entities/reviews.entity';
import { Meta } from '../metas/entities/meta.entity';
import { Medalha } from '../medalhas/entities/medalha.entity';
import { Denuncia } from '../denuncias/entities/denuncia.entity';
import { Publicacao } from '../publicacoes/entities/publicacao.entity';
import { PublicacaoAnexo } from '../publicacoes/entities/publicacao-anexo.entity';
import { Interesse } from '../interesses/entities/interesse.entity';
import { Conversa } from '../conversas/entities/conversa.entity';
import { Mensagem } from '../conversas/entities/mensagem.entity';
import { PasswordResetToken } from '../password-reset/entities/password-reset-token.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { Session } from '../auth/entities/session.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationDocument } from '../organizations/entities/organization-document.entity';
import { OrganizationValidation } from '../organizations/entities/organization-validation.entity';
import { OrganizationExternalCheck } from '../organizations/entities/organization-external-check.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Donation } from '../donations/entities/donation.entity';
import { PaymentEvent } from '../payments/payment-event.entity';
import { OrganizationPaymentAccount } from '../payments/entities/organization-payment-account.entity';
import { Expense, ExpenseDocument } from '../accountability/entities/expense.entity';
import { DeliveryRecord, DeliveryEvidence } from '../accountability/entities/delivery.entity';

/** Lista única de entidades: usada pela aplicação, pela CLI de migrations e pelos testes. */
export const ENTITIES = [
  User,
  Reviews,
  Meta,
  Medalha,
  Denuncia,
  Publicacao,
  PublicacaoAnexo,
  Favorito,
  Interesse,
  Conversa,
  Mensagem,
  PedidoMedalhaBranca,
  DocumentoMedalhaBranca,
  PasswordResetToken,
  Session,
  AuditLog,
  Organization,
  OrganizationDocument,
  OrganizationValidation,
  OrganizationExternalCheck,
  Campaign,
  Donation,
  PaymentEvent,
  OrganizationPaymentAccount,
  Expense,
  ExpenseDocument,
  DeliveryRecord,
  DeliveryEvidence,
];
