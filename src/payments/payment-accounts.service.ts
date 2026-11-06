import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-context';
import { openSecret, sealSecret } from '../common/secret-box';
import { Organization, OrganizationStatus } from '../organizations/entities/organization.entity';
import { AsaasError, AsaasService } from './asaas.service';
import { OrganizationPaymentAccount, PaymentAccountStatus as S } from './entities/organization-payment-account.entity';

const digits = (v?: string | null) => (v ?? '').replace(/\D/g, '');
const env = () => (process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox');
const aad = (organizationId: string) => `payment-account:${organizationId}`;

/** Eventos que a subconta envia ao nosso webhook (configurados na criação, se ASAAS_WEBHOOK_URL existir). */
const WEBHOOK_EVENTS = [
  'PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'TRANSFER_CREATED', 'TRANSFER_PENDING', 'TRANSFER_IN_BANK_PROCESSING', 'TRANSFER_BLOCKED', 'TRANSFER_DONE', 'TRANSFER_FAILED', 'TRANSFER_CANCELLED',
];

@Injectable()
export class PaymentAccountsService {
  private readonly logger = new Logger(PaymentAccountsService.name);

  constructor(
    @InjectRepository(OrganizationPaymentAccount) private repo: Repository<OrganizationPaymentAccount>,
    @InjectRepository(Organization) private orgs: Repository<Organization>,
    private asaas: AsaasService,
    private audit: AuditService,
  ) {}

  // ---------- Visões (nenhuma contém a chave de API) ----------

  private adminView(a: OrganizationPaymentAccount | null) {
    if (!a) return { exists: false, status: null, canProvision: true };
    return {
      exists: true,
      id: a.id,
      provider: a.provider,
      environment: a.environment,
      status: a.status,
      statusDetail: a.statusDetail,
      providerStatus: a.providerStatus,
      providerAccountId: a.providerAccountId,
      walletIdTail: a.walletId ? a.walletId.slice(-6) : null,
      approvedAt: a.approvedAt,
      lastCheckedAt: a.lastCheckedAt,
      createdAt: a.createdAt,
      canProvision: a.status === S.FALHA && !a.providerAccountId,
    };
  }

  /** A ONG só enxerga a própria situação, sem identificadores do provedor nem detalhes técnicos. */
  private ongView(a: OrganizationPaymentAccount | null) {
    const status = a?.status ?? null;
    return {
      status,
      canReceiveDonations: status === S.ATIVA && a?.environment === env(),
      message:
        status === S.ATIVA ? 'Conta de recebimento ativa.'
        : status === S.AGUARDANDO_APROVACAO || status === S.CRIANDO ? 'Conta de recebimento em análise pelo provedor de pagamento.'
        : status === S.REJEITADA || status === S.BLOQUEADA ? 'Conta de recebimento indisponível. A equipe da plataforma entrará em contato.'
        : status === S.FALHA ? 'Não foi possível criar a conta de recebimento. A equipe da plataforma foi avisada.'
        : 'A conta de recebimento ainda não foi criada.',
    };
  }

  private async orgOrFail(id: string) {
    const org = await this.orgs.findOneBy({ id });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    return org;
  }

  async getForAdmin(organizationId: string) {
    await this.orgOrFail(organizationId);
    return this.adminView(await this.repo.findOneBy({ organizationId }));
  }

  async getMine(ownerId: number) {
    const org = await this.orgs.findOneBy({ ownerId });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    return this.ongView(await this.repo.findOneBy({ organizationId: org.id }));
  }

  /** Para a vitrine pública e o fluxo de doação: apenas "pode receber?", sem nada do provedor. */
  async canReceive(organizationId: string): Promise<boolean> {
    const a = await this.repo.findOneBy({ organizationId });
    return a?.status === S.ATIVA && a.environment === env();
  }

  // ---------- Criação ----------

  /** Dados que o provedor exige. O que faltar é listado: nunca preenchemos com valores inventados. */
  private payloadOf(org: Organization, incomeValue: number) {
    const name = (org.tradeName?.trim() || org.legalName).trim();
    const missing: string[] = [];
    if (digits(org.cnpj).length !== 14) missing.push('CNPJ');
    if (!org.email) missing.push('e-mail');
    if (digits(org.phone).length < 10) missing.push('telefone celular');
    if (!org.street) missing.push('logradouro');
    if (!org.number) missing.push('número');
    if (!org.district) missing.push('bairro');
    if (digits(org.zip).length !== 8) missing.push('CEP');
    if (missing.length) {
      throw new UnprocessableEntityException({ message: 'Cadastro da ONG incompleto para abrir a conta de recebimento.', missing });
    }
    const webhookUrl = process.env.ASAAS_WEBHOOK_URL;
    const token = process.env.ASAAS_WEBHOOK_TOKEN;
    return {
      name,
      email: org.email,
      cpfCnpj: digits(org.cnpj),
      mobilePhone: digits(org.phone),
      incomeValue,
      address: org.street,
      addressNumber: org.number,
      complement: org.complement ?? undefined,
      province: org.district,
      postalCode: digits(org.zip),
      companyType: 'ASSOCIATION',
      ...(webhookUrl && token
        ? { webhooks: [{ name: 'Donatio', url: webhookUrl, email: org.email, enabled: true, interrupted: false, apiVersion: 3, sendType: 'NON_SEQUENTIALLY', authToken: token, events: WEBHOOK_EVENTS }] }
        : {}),
    };
  }

  /**
   * Abre a subconta da ONG. Segurança contra duplicidade: a linha é reservada no banco (organizationId único) ANTES de
   * falar com o provedor; duas chamadas simultâneas disputam essa reserva e só uma segue. Se o provedor falhar, nada
   * cai na conta da plataforma: a ONG fica sem conta e a doação é recusada (ver credentialsFor).
   */
  async provision(admin: RequestUser, organizationId: string, incomeValue: number, ip?: string) {
    const org = await this.orgOrFail(organizationId);
    if (org.status !== OrganizationStatus.APROVADA) {
      throw new ConflictException('A conta de recebimento só é aberta depois da aprovação institucional da ONG.');
    }
    const payload = this.payloadOf(org, incomeValue);

    const current = await this.repo.findOneBy({ organizationId });
    if (current && !(current.status === S.FALHA && !current.providerAccountId)) {
      throw new ConflictException(
        current.status === S.FALHA
          ? 'A conta chegou a ser criada no provedor, mas a credencial não foi guardada. Procure o suporte do Asaas: não é seguro criar outra.'
          : 'Esta ONG já possui conta de recebimento.',
      );
    }
    let row: OrganizationPaymentAccount;
    if (current) {
      // nova tentativa depois de falha sem efeito no provedor: reserva atômica (só uma chamada vence)
      const r = await this.repo.update({ id: current.id, status: S.FALHA }, { status: S.CRIANDO, statusDetail: null, createdBy: admin.id });
      if (!r.affected) throw new ConflictException('Já existe uma criação em andamento para esta ONG.');
      row = current;
    } else {
      try {
        row = await this.repo.save(this.repo.create({ organizationId, environment: env(), createdBy: admin.id }));
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe uma criação em andamento para esta ONG.');
        throw e;
      }
    }

    let created;
    try {
      created = await this.asaas.createSubaccount(payload);
    } catch (e) {
      await this.fail(row, e);
      await this.audit.log({ actor: admin, action: 'PAYMENT_ACCOUNT_FAILED', entityType: 'organization', entityId: organizationId, organizationId, metadata: { step: 'create', providerStatus: (e as AsaasError).providerStatus ?? null }, ip });
      throw e;
    }
    try {
      await this.repo.update(row.id, {
        providerAccountId: created.id,
        walletId: created.walletId,
        apiKeyEnc: sealSecret(created.apiKey, aad(organizationId)),
        environment: env(),
        status: S.AGUARDANDO_APROVACAO,
        statusDetail: null,
      });
    } catch (e) {
      // A conta existe no provedor mas não conseguimos guardar a credencial: registra o id (sem a chave) para o suporte.
      this.logger.error(`Subconta ${created.id} criada, mas a credencial não foi guardada: ${(e as Error).message}`);
      await this.repo.update(row.id, { providerAccountId: created.id, status: S.FALHA, statusDetail: 'Conta criada no provedor, mas a credencial não pôde ser guardada com segurança.' }).catch(() => undefined);
      throw e;
    }
    await this.audit.log({ actor: admin, action: 'PAYMENT_ACCOUNT_CREATED', entityType: 'organization', entityId: organizationId, organizationId, metadata: { providerAccountId: created.id, environment: env() }, ip });
    return this.adminView(await this.repo.findOneByOrFail({ id: row.id }));
  }

  private async fail(row: OrganizationPaymentAccount, e: unknown) {
    const pe = e as AsaasError;
    const detail = pe.providerMessage ?? (e as Error).message;
    await this.repo.update(row.id, { status: S.FALHA, statusDetail: `Falha ao criar a conta no provedor${pe.providerStatus ? ` (HTTP ${pe.providerStatus})` : ''}: ${detail}`.slice(0, 500) });
  }

  // ---------- Situação cadastral ----------

  /** Consulta o provedor com a credencial da própria subconta e atualiza o status. Falha de rede não altera nada. */
  async refresh(admin: RequestUser, organizationId: string, ip?: string) {
    const a = await this.withKey(organizationId);
    if (!a) throw new NotFoundException('Esta ONG ainda não possui conta de recebimento.');
    if (!a.apiKeyEnc || !a.providerAccountId) throw new ConflictException('A conta não tem credencial guardada.');
    let remote;
    try {
      remote = await this.asaas.getAccountStatus(openSecret(a.apiKeyEnc, aad(organizationId)));
    } catch (e) {
      const pe = e as AsaasError;
      if (pe.providerStatus === 401) {
        await this.repo.update(a.id, { status: S.BLOQUEADA, statusDetail: 'O provedor recusou a credencial da subconta.', lastCheckedAt: new Date() });
        await this.audit.log({ actor: admin, action: 'PAYMENT_ACCOUNT_STATUS_CHANGED', entityType: 'organization', entityId: organizationId, organizationId, metadata: { from: a.status, to: S.BLOQUEADA }, ip });
        return this.adminView(await this.repo.findOneByOrFail({ id: a.id }));
      }
      throw e;
    }
    const next = this.statusFrom(remote.general);
    const patch: Partial<OrganizationPaymentAccount> = {
      providerStatus: { general: remote.general, ...(remote.commercialInfo ? { commercialInfo: remote.commercialInfo } : {}), ...(remote.bankAccountInfo ? { bankAccountInfo: remote.bankAccountInfo } : {}), ...(remote.documentation ? { documentation: remote.documentation } : {}) },
      lastCheckedAt: new Date(),
      statusDetail: next === S.REJEITADA ? 'O provedor rejeitou o cadastro da subconta.' : null,
    };
    if (next !== a.status) patch.status = next;
    if (next === S.ATIVA && !a.approvedAt) patch.approvedAt = new Date();
    await this.repo.update(a.id, patch);
    if (next !== a.status) {
      await this.audit.log({ actor: admin, action: 'PAYMENT_ACCOUNT_STATUS_CHANGED', entityType: 'organization', entityId: organizationId, organizationId, metadata: { from: a.status, to: next, providerGeneral: remote.general }, ip });
    }
    return this.adminView(await this.repo.findOneByOrFail({ id: a.id }));
  }

  private statusFrom(general: string): S {
    if (general === 'APPROVED') return S.ATIVA;
    if (general === 'REJECTED') return S.REJEITADA;
    return S.AGUARDANDO_APROVACAO; // PENDING, AWAITING_ACTION_AUTHORIZATION e desconhecidos: nunca liberam doações
  }

  /** Somente Sandbox: pede ao Asaas para aprovar a subconta e relê o status real. */
  async approveInSandbox(admin: RequestUser, organizationId: string, ip?: string) {
    const a = await this.withKey(organizationId);
    if (!a?.providerAccountId) throw new NotFoundException('Esta ONG ainda não possui conta de recebimento.');
    if (a.environment !== 'sandbox' || env() !== 'sandbox') throw new ForbiddenException('Aprovação manual existe apenas no Sandbox.');
    await this.asaas.approveSandboxSubaccount(a.providerAccountId);
    await this.audit.log({ actor: admin, action: 'PAYMENT_ACCOUNT_SANDBOX_APPROVAL_REQUESTED', entityType: 'organization', entityId: organizationId, organizationId, metadata: { providerAccountId: a.providerAccountId }, ip });
    return this.refresh(admin, organizationId, ip);
  }

  private withKey(organizationId: string) {
    return this.repo.findOne({ where: { organizationId }, select: { id: true, organizationId: true, status: true, environment: true, providerAccountId: true, walletId: true, apiKeyEnc: true, approvedAt: true } });
  }

  // ---------- Uso interno (Etapa 2: cobranças na subconta) ----------

  /**
   * Credencial da subconta da ONG para criar cobranças. Falha fechada: sem subconta ATIVA, do ambiente atual e com
   * credencial íntegra, lança erro. Não existe retorno para a conta da plataforma.
   */
  async credentialsFor(organizationId: string): Promise<{ apiKey: string; walletId: string }> {
    const a = await this.withKey(organizationId);
    if (!a || a.status !== S.ATIVA || a.environment !== env() || !a.apiKeyEnc || !a.walletId) {
      throw new ConflictException('Esta ONG ainda não pode receber doações: a conta de recebimento não está ativa.');
    }
    try {
      return { apiKey: openSecret(a.apiKeyEnc, aad(organizationId)), walletId: a.walletId };
    } catch {
      this.logger.error(`Credencial da subconta da organização ${organizationId} não pôde ser aberta.`);
      throw new ConflictException('Esta ONG ainda não pode receber doações: credencial de recebimento inválida.');
    }
  }
}
