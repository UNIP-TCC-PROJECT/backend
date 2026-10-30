import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Campaign, CampaignStatus } from '../campaigns/entities/campaign.entity';
import type { RequestUser } from '../common/request-context';
import { isValidCpf, onlyDigits } from '../organizations/cnpj.util';
import { OrganizationStatus } from '../organizations/entities/organization.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { AsaasPayment, AsaasService } from '../payments/asaas.service';
import { User } from '../users/entities/user.entity';
import { Donation, DonationStatus } from './entities/donation.entity';

// Estados do Asaas que significam "dinheiro pago". RECEIVED_IN_CASH é baixa manual e NÃO conta.
const PAID = ['RECEIVED', 'CONFIRMED'];
const REVERSED = ['REFUNDED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];

export type ReconcileOutcome = 'APPLIED' | 'NO_CHANGE' | 'IGNORED_UNKNOWN_PAYMENT' | 'REJECTED_MISMATCH';

const addDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

@Injectable()
export class DonationsService {
  constructor(
    @InjectRepository(Donation) private repo: Repository<Donation>,
    @InjectRepository(Campaign) private campaigns: Repository<Campaign>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private dataSource: DataSource,
    private orgs: OrganizationsService,
    private asaas: AsaasService,
    private audit: AuditService,
  ) {}

  /** Visão segura para o doador/ONG: sem ids do provedor. */
  private view(d: Donation) {
    return {
      id: d.id, campaignId: d.campaignId, amountCents: d.amountCents, status: d.status,
      createdAt: d.createdAt, confirmedAt: d.confirmedAt, refundedAt: d.refundedAt,
      ...(d.status === DonationStatus.PENDENTE ? { pixPayload: d.pixPayload, pixExpiresAt: d.pixExpiresAt } : {}),
    };
  }

  // ---------- Criação da doação + cobrança Pix ----------

  async create(donor: RequestUser, campaignId: string, dto: { amountCents: number; cpf?: string }, idempotencyKey: string | undefined, ip?: string) {
    if (idempotencyKey) {
      const existing = await this.repo.findOneBy({ donorId: donor.id, idempotencyKey });
      if (existing) return this.withQr(existing);
    }
    const now = new Date();
    const c = await this.campaigns.findOne({ where: { id: campaignId }, relations: { organization: true } });
    const open = c && c.status === CampaignStatus.ATIVA && c.organization.status === OrganizationStatus.APROVADA
      && (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt > now);
    if (!c || !open) throw new NotFoundException('Campanha não encontrada ou indisponível para doações.');

    const user = await this.users.findOneByOrFail({ id: donor.id });
    const cpf = onlyDigits(user.cpf) || onlyDigits(dto.cpf);
    if (!isValidCpf(cpf)) throw new BadRequestException('Informe um CPF válido para emitir o Pix.');
    if (idempotencyKey && !/^[\w-]{8,80}$/.test(idempotencyKey)) throw new BadRequestException('Idempotency-Key inválida.');

    // 1) registra a doação local (PENDENTE) antes de falar com o provedor
    let d: Donation;
    try {
      d = await this.repo.save(this.repo.create({ campaignId, donorId: donor.id, amountCents: dto.amountCents, idempotencyKey: idempotencyKey ?? null }));
    } catch (e) {
      // dois POSTs simultâneos com a mesma chave: o segundo devolve o primeiro
      const again = idempotencyKey && (await this.repo.findOneBy({ donorId: donor.id, idempotencyKey }));
      if (again) return this.withQr(again);
      throw e;
    }
    await this.audit.log({ actor: donor, action: 'DONATION_CREATED', entityType: 'donation', entityId: d.id, organizationId: c.organizationId, metadata: { amountCents: d.amountCents, campaignId }, ip });

    // 2) cria a cobrança Pix; se o provedor falhar, a doação não fica "fantasma" pendente
    try {
      const customerId = user.asaasCustomerId ?? (await this.asaas.createCustomer({ name: user.name, cpfCnpj: cpf, email: user.email, externalReference: `donor-${user.id}` })).id;
      if (!user.asaasCustomerId) await this.users.update(user.id, { asaasCustomerId: customerId });
      const payment = await this.asaas.createPixPayment({
        customer: customerId, value: d.amountCents / 100, dueDate: addDays(1),
        description: `Doação — ${c.title}`.slice(0, 200), externalReference: d.id,
      });
      const qr = await this.asaas.getPixQrCode(payment.id);
      await this.repo.update(d.id, { providerPaymentId: payment.id, pixPayload: qr.payload, pixExpiresAt: qr.expirationDate ? new Date(qr.expirationDate) : null });
      return { ...this.view({ ...d, pixPayload: qr.payload, pixExpiresAt: qr.expirationDate ? new Date(qr.expirationDate) : null } as Donation), pix: { payload: qr.payload, qrCodeBase64: qr.encodedImage, expiresAt: qr.expirationDate } };
    } catch (e) {
      await this.repo.update(d.id, { status: DonationStatus.CANCELADA, failureReason: 'Falha ao criar cobrança no provedor' });
      await this.audit.log({ actor: donor, action: 'DONATION_CANCELLED', entityType: 'donation', entityId: d.id, organizationId: c.organizationId, metadata: { reason: 'provider_error' }, ip });
      throw e;
    }
  }

  /** Doação pendente + QR Code (a imagem é buscada no provedor; se falhar, devolve só o copia e cola). */
  private async withQr(d: Donation) {
    if (d.status !== DonationStatus.PENDENTE || !d.providerPaymentId) return this.view(d);
    const qr = await this.asaas.getPixQrCode(d.providerPaymentId).catch(() => null);
    return { ...this.view(d), pix: { payload: qr?.payload ?? d.pixPayload, qrCodeBase64: qr?.encodedImage ?? null, expiresAt: qr?.expirationDate ?? d.pixExpiresAt } };
  }

  // ---------- Reconciliação: ÚNICO ponto que altera o status por pagamento ----------

  /**
   * Consulta a cobrança no Asaas (fonte da verdade) e aplica a transição. O corpo do webhook
   * serve apenas para localizar o pagamento: status e valor vêm sempre da consulta autenticada.
   * Idempotente: repetir a chamada não duplica nada (a doação é uma linha, bloqueada na transação).
   */
  async reconcile(providerPaymentId: string, source: { kind: 'webhook' | 'sync' | 'admin'; eventId?: string; actor?: RequestUser }): Promise<{ outcome: ReconcileOutcome; donation?: Donation }> {
    const remote = await this.asaas.getPayment(providerPaymentId);
    return this.dataSource.transaction(async (m) => {
      const d = await m.findOne(Donation, { where: { providerPaymentId }, relations: { campaign: true }, lock: { mode: 'pessimistic_write', tables: ['donations'] } });
      if (!d) return { outcome: 'IGNORED_UNKNOWN_PAYMENT' as const };

      // Conferência de identidade e valor antes de qualquer mudança
      const valueOk = Math.round(Number(remote.value) * 100) === d.amountCents;
      if (remote.id !== providerPaymentId || remote.externalReference !== d.id || remote.billingType !== 'PIX' || !valueOk) {
        await this.audit.log({ action: 'DONATION_PAYMENT_MISMATCH', entityType: 'donation', entityId: d.id, organizationId: d.campaign.organizationId, metadata: { paymentId: providerPaymentId, remoteValue: remote.value, expectedCents: d.amountCents, remoteRef: remote.externalReference ?? null } }, m);
        return { outcome: 'REJECTED_MISMATCH' as const, donation: d };
      }

      const target = this.targetStatus(remote, d.status);
      if (!target) return { outcome: 'NO_CHANGE' as const, donation: d };

      const patch: Partial<Donation> = { status: target };
      if (target === DonationStatus.CONFIRMADA) patch.confirmedAt = new Date();
      if (target === DonationStatus.ESTORNADA) patch.refundedAt = new Date();
      await m.update(Donation, d.id, patch);
      const action = { CONFIRMADA: 'DONATION_CONFIRMED', ESTORNADA: 'DONATION_REFUNDED', CANCELADA: 'DONATION_CANCELLED' }[target as 'CONFIRMADA' | 'ESTORNADA' | 'CANCELADA'];
      await this.audit.log({ actor: source.actor, action, entityType: 'donation', entityId: d.id, organizationId: d.campaign.organizationId, metadata: { amountCents: d.amountCents, via: source.kind, eventId: source.eventId ?? null, providerStatus: remote.status } }, m);
      return { outcome: 'APPLIED' as const, donation: { ...d, ...patch } as Donation };
    });
  }

  /** Transições permitidas; qualquer outra combinação é ignorada. */
  private targetStatus(remote: AsaasPayment, current: DonationStatus): DonationStatus | null {
    if (PAID.includes(remote.status) && current === DonationStatus.PENDENTE) return DonationStatus.CONFIRMADA;
    if (REVERSED.includes(remote.status) && current === DonationStatus.CONFIRMADA) return DonationStatus.ESTORNADA;
    if ((remote.deleted || remote.status === 'OVERDUE') && current === DonationStatus.PENDENTE) return DonationStatus.CANCELADA;
    return null;
  }

  // ---------- Consultas do doador ----------

  private ownDonation(donorId: number, id: string) {
    return this.repo.findOne({ where: { id, donorId } }).then((d) => {
      if (!d) throw new NotFoundException('Doação não encontrada.');
      return d;
    });
  }

  async listMine(donorId: number) {
    const rows = await this.repo.find({ where: { donorId }, relations: { campaign: { organization: true } }, order: { createdAt: 'DESC' } });
    return rows.map((d) => ({ ...this.view(d), campaignTitle: d.campaign.title, organizationName: d.campaign.organization.tradeName ?? d.campaign.organization.legalName }));
  }

  async summaryMine(donorId: number) {
    const rows = await this.repo.find({ where: { donorId } });
    const by = (s: DonationStatus) => rows.filter((d) => d.status === s);
    return {
      totalConfirmedCents: by(DonationStatus.CONFIRMADA).reduce((a, d) => a + d.amountCents, 0),
      confirmed: by(DonationStatus.CONFIRMADA).length, pending: by(DonationStatus.PENDENTE).length,
      cancelled: by(DonationStatus.CANCELADA).length, refunded: by(DonationStatus.ESTORNADA).length,
      campaignsSupported: new Set(by(DonationStatus.CONFIRMADA).map((d) => d.campaignId)).size,
    };
  }

  async getMine(donorId: number, id: string) {
    return this.withQr(await this.ownDonation(donorId, id));
  }

  /** O doador pode pedir a verificação junto ao provedor; nunca confirma por conta própria. */
  async syncMine(donor: RequestUser, id: string) {
    const d = await this.ownDonation(donor.id, id);
    if (d.providerPaymentId) await this.reconcile(d.providerPaymentId, { kind: 'sync', actor: undefined });
    return this.getMine(donor.id, id);
  }

  // ---------- Painel da ONG ----------

  async listForOrganization(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    const rows = await this.repo.createQueryBuilder('d').innerJoin('d.campaign', 'c', 'c.organizationId = :org', { org: org.id }).orderBy('d.createdAt', 'DESC').getMany();
    return rows.map((d) => this.view(d)); // sem dados pessoais do doador
  }

  async dashboard(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    const rows = await this.repo.createQueryBuilder('d').innerJoinAndSelect('d.campaign', 'c', 'c.organizationId = :org', { org: org.id }).getMany();
    const camps = await this.campaigns.find({ where: { organizationId: org.id } });
    const sum = (s: DonationStatus) => rows.filter((d) => d.status === s).reduce((a, d) => a + d.amountCents, 0);
    const count = (s: DonationStatus) => rows.filter((d) => d.status === s).length;
    return {
      totalRaisedCents: sum(DonationStatus.CONFIRMADA), pendingCents: sum(DonationStatus.PENDENTE), refundedCents: sum(DonationStatus.ESTORNADA),
      donationsTotal: rows.length, donationsConfirmed: count(DonationStatus.CONFIRMADA), donationsPending: count(DonationStatus.PENDENTE),
      donationsCancelled: count(DonationStatus.CANCELADA), donationsRefunded: count(DonationStatus.ESTORNADA),
      activeCampaigns: camps.filter((c) => c.status === CampaignStatus.ATIVA).length,
      campaigns: camps.map((c) => ({ id: c.id, title: c.title, status: c.status, goalCents: c.goalCents, raisedCents: rows.filter((d) => d.campaignId === c.id && d.status === DonationStatus.CONFIRMADA).reduce((a, d) => a + d.amountCents, 0) })),
    };
  }

  /** Movimentações: entrada na confirmação e saída no estorno, em ordem cronológica. */
  async financialHistory(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    const rows = await this.repo.createQueryBuilder('d').innerJoinAndSelect('d.campaign', 'c', 'c.organizationId = :org', { org: org.id })
      .where('d.status IN (:...s)', { s: [DonationStatus.CONFIRMADA, DonationStatus.ESTORNADA] }).getMany();
    return rows.flatMap((d) => [
      { donationId: d.id, type: 'ENTRADA', amountCents: d.amountCents, at: d.confirmedAt, campaignTitle: d.campaign.title },
      ...(d.status === DonationStatus.ESTORNADA ? [{ donationId: d.id, type: 'ESTORNO', amountCents: -d.amountCents, at: d.refundedAt, campaignTitle: d.campaign.title }] : []),
    ]).sort((a, b) => +new Date(b.at ?? 0) - +new Date(a.at ?? 0));
  }

  // ---------- Administração ----------

  async adminReconcile(admin: RequestUser, id: string) {
    const d = await this.repo.findOneBy({ id });
    if (!d) throw new NotFoundException('Doação não encontrada.');
    if (!d.providerPaymentId) throw new ForbiddenException('Doação sem cobrança no provedor.');
    const r = await this.reconcile(d.providerPaymentId, { kind: 'admin', actor: admin });
    return { outcome: r.outcome, status: (await this.repo.findOneByOrFail({ id })).status };
  }

  listAdmin(status?: DonationStatus) {
    return this.repo.find({ where: status ? { status: In([status]) } : {}, order: { createdAt: 'DESC' }, take: 200 });
  }
}
