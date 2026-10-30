import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { AccStatus, needsReason, nextStatus } from '../common/accountability-status';
import { prepareFile } from '../common/file-upload';
import type { RequestUser } from '../common/request-context';
import { stripImageMetadata } from '../common/sanitize';
import { Donation, DonationStatus } from '../donations/entities/donation.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { onlyDigits } from '../organizations/cnpj.util';
import { User, UserType } from '../users/entities/user.entity';
import type { CreateDeliveryDto, CreateExpenseDto, ReviewActionDto, UpdateEvidenceDto, UpdateExpenseDto, UploadEvidenceDto, UploadExpenseDocumentDto } from './accountability.dto';
import { DeliveryEvidence, DeliveryRecord } from './entities/delivery.entity';
import { Expense, ExpenseDocument } from './entities/expense.entity';

const FILE_COLS = { id: true, organizationId: true, name: true, mime: true, size: true, sha256: true, status: true, reviewReason: true, reviewedAt: true, createdAt: true } as const;
const NOT_FOUND = 'Registro não encontrado.';
const EDITABLE = [AccStatus.ENVIADA, AccStatus.NECESSITA_COMPLEMENTACAO];
const todayIso = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class AccountabilityService implements OnModuleInit {
  constructor(
    @InjectRepository(Expense) private expenses: Repository<Expense>,
    @InjectRepository(ExpenseDocument) private expenseDocs: Repository<ExpenseDocument>,
    @InjectRepository(DeliveryRecord) private deliveries: Repository<DeliveryRecord>,
    @InjectRepository(DeliveryEvidence) private evidences: Repository<DeliveryEvidence>,
    @InjectRepository(Campaign) private campaigns: Repository<Campaign>,
    @InjectRepository(Donation) private donations: Repository<Donation>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private dataSource: DataSource,
    private orgs: OrganizationsService,
    private audit: AuditService,
  ) {}

  // Vocabulário de estados renomeado (PENDENTE/APROVADO/REPROVADO → ENVIADA/APROVADA/REPROVADA).
  async onModuleInit() {
    const map: [string, string][] = [['PENDENTE', 'ENVIADA'], ['APROVADO', 'APROVADA'], ['REPROVADO', 'REPROVADA']];
    for (const repo of [this.expenses, this.expenseDocs, this.evidences] as Repository<any>[]) {
      for (const [from, to] of map) await repo.update({ status: from }, { status: to });
    }
  }

  // ---------- Números financeiros: sempre calculados dos registros, nunca digitados ----------

  async financials(organizationId: string, campaignId?: string) {
    const raisedRow = await this.donations.createQueryBuilder('d').innerJoin('d.campaign', 'c', 'c.organizationId = :o', { o: organizationId })
      .where('d.status = :s', { s: DonationStatus.CONFIRMADA }).andWhere(campaignId ? 'c.id = :c' : '1=1', { c: campaignId })
      .select('COALESCE(SUM(d.amountCents), 0)', 'sum').getRawOne();
    const byStatus = await this.expenses.createQueryBuilder('e').where('e.organizationId = :o', { o: organizationId })
      .andWhere(campaignId ? 'e.campaignId = :c' : '1=1', { c: campaignId })
      .select('e.status', 'status').addSelect('COUNT(*)', 'n').addSelect('COALESCE(SUM(e.amountCents), 0)', 'sum').groupBy('e.status').getRawMany();
    const sum = (...st: AccStatus[]) => byStatus.filter((r) => st.includes(r.status)).reduce((a, r) => a + Number(r.sum), 0);
    const cnt = (...st: AccStatus[]) => byStatus.filter((r) => st.includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
    const delivQ = this.deliveries.createQueryBuilder('r').where('r.organizationId = :o', { o: organizationId }).andWhere(campaignId ? 'r.campaignId = :c' : '1=1', { c: campaignId });
    const verified = await delivQ.clone().innerJoin(DeliveryEvidence, 'ev', 'ev.deliveryRecordId = r.id AND ev.status = :ok', { ok: AccStatus.APROVADA }).select('COUNT(DISTINCT r.id)', 'n').getRawOne();
    const raised = Number(raisedRow.sum);
    const approved = sum(AccStatus.APROVADA);
    return {
      totalRaisedCents: raised,
      approvedExpensesCents: approved,
      balanceCents: raised - approved,
      pendingExpensesCents: sum(AccStatus.ENVIADA, AccStatus.EM_ANALISE),
      pendingExpensesCount: cnt(AccStatus.ENVIADA, AccStatus.EM_ANALISE),
      needsComplementCount: cnt(AccStatus.NECESSITA_COMPLEMENTACAO),
      approvedExpensesCount: cnt(AccStatus.APROVADA),
      deliveriesRegistered: await delivQ.getCount(),
      deliveriesVerified: Number(verified.n),
    };
  }

  async summaryMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    const camps = await this.campaigns.find({ where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
    return {
      ...(await this.financials(org.id)),
      campaigns: await Promise.all(camps.map(async (c) => ({ id: c.id, title: c.title, status: c.status, ...(await this.financials(org.id, c.id)) }))),
    };
  }

  // ---------- Despesas (ONG) ----------

  private async ownCampaign(userId: number, campaignId: string) {
    const org = await this.orgs.approvedOfOwner(userId);
    if (!(await this.campaigns.existsBy({ id: campaignId, organizationId: org.id }))) throw new NotFoundException('Campanha não encontrada.');
    return org;
  }

  private checkDate(d: string) {
    if (d.slice(0, 10) > todayIso()) throw new BadRequestException('A data não pode estar no futuro.');
  }

  async createExpense(user: RequestUser, dto: CreateExpenseDto, ip?: string) {
    const org = await this.ownCampaign(user.id, dto.campaignId);
    this.checkDate(dto.spentAt);
    const e = await this.expenses.save(this.expenses.create({ ...dto, supplierDocument: dto.supplierDocument ? onlyDigits(dto.supplierDocument) : null, supplier: dto.supplier ?? null, organizationId: org.id, status: AccStatus.ENVIADA }));
    await this.audit.log({ actor: user, action: 'EXPENSE_CREATED', entityType: 'expense', entityId: e.id, organizationId: org.id, metadata: { amountCents: e.amountCents, campaignId: e.campaignId }, ip });
    return e;
  }

  private async ownExpense(userId: number, id: string) {
    const org = await this.orgs.approvedOfOwner(userId);
    const e = await this.expenses.findOneBy({ id, organizationId: org.id });
    if (!e) throw new NotFoundException(NOT_FOUND);
    return e;
  }

  async updateExpense(user: RequestUser, id: string, dto: UpdateExpenseDto, ip?: string) {
    const e = await this.ownExpense(user.id, id);
    if (!EDITABLE.includes(e.status)) throw new BadRequestException('Despesa em análise ou já decidida não pode ser alterada.');
    if (dto.spentAt) this.checkDate(dto.spentAt);
    const fields = Object.keys(dto);
    Object.assign(e, dto, dto.supplierDocument ? { supplierDocument: onlyDigits(dto.supplierDocument) } : {});
    await this.expenses.save(e);
    await this.audit.log({ actor: user, action: 'EXPENSE_UPDATED', entityType: 'expense', entityId: id, organizationId: e.organizationId, metadata: { fields }, ip });
    return e;
  }

  /** Devolve à fila depois de atender o pedido de complementação. */
  async resubmitExpense(user: RequestUser, id: string, ip?: string) {
    const e = await this.ownExpense(user.id, id);
    if (e.status !== AccStatus.NECESSITA_COMPLEMENTACAO) throw new BadRequestException('Apenas despesas com pedido de complementação podem ser reenviadas.');
    await this.expenses.update(id, { status: AccStatus.ENVIADA, reviewReason: null });
    await this.audit.log({ actor: user, action: 'EXPENSE_RESUBMITTED', entityType: 'expense', entityId: id, organizationId: e.organizationId, ip });
    return this.expenses.findOneByOrFail({ id });
  }

  async listExpensesMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    const rows = await this.expenses.find({ where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
    const docs = rows.length ? await this.expenseDocs.find({ select: { ...FILE_COLS, expenseId: true, kind: true }, where: { expenseId: In(rows.map((r) => r.id)) } }) : [];
    return rows.map((e) => ({ ...e, documents: docs.filter((d) => d.expenseId === e.id) }));
  }

  async uploadExpenseDocument(user: RequestUser, expenseId: string, dto: UploadExpenseDocumentDto, file: Express.Multer.File | undefined, ip?: string) {
    const e = await this.ownExpense(user.id, expenseId);
    if (!EDITABLE.includes(e.status)) throw new BadRequestException('Não é possível anexar documentos neste estado.');
    const data = prepareFile(file);
    const doc = await this.expenseDocs.save(this.expenseDocs.create({ ...data, kind: dto.kind, organizationId: e.organizationId, expenseId, uploadedBy: user.id, status: AccStatus.ENVIADA }));
    await this.audit.log({ actor: user, action: 'EXPENSE_DOCUMENT_UPLOADED', entityType: 'expense_document', entityId: doc.id, organizationId: e.organizationId, metadata: { expenseId, kind: dto.kind, sha256: data.sha256 }, ip });
    const { content, ...meta } = doc;
    return meta;
  }

  async listExpenseDocuments(user: RequestUser, expenseId: string) {
    const org = user.type === UserType.ADMIN ? null : await this.orgs.ofOwner(user.id);
    const e = await this.expenses.findOneBy(org ? { id: expenseId, organizationId: org.id } : { id: expenseId });
    if (!e) throw new NotFoundException(NOT_FOUND);
    return this.expenseDocs.find({ select: { ...FILE_COLS, kind: true, publishable: true }, where: { expenseId }, order: { createdAt: 'DESC' } });
  }

  async expenseDocumentFile(user: RequestUser, id: string) {
    const doc = await this.expenseDocs.findOne({ where: { id }, select: { ...FILE_COLS, content: true } });
    return this.visibleTo(user, doc);
  }

  // ---------- Entregas (ONG) ----------

  async createDelivery(user: RequestUser, dto: CreateDeliveryDto, ip?: string) {
    const org = await this.ownCampaign(user.id, dto.campaignId);
    this.checkDate(dto.deliveredAt);
    if (dto.quantityDistributed > dto.quantityPurchased) throw new BadRequestException('A quantidade distribuída não pode superar a quantidade comprada.');
    if (dto.expenseId && !(await this.expenses.existsBy({ id: dto.expenseId, organizationId: org.id, campaignId: dto.campaignId }))) throw new NotFoundException('Despesa não encontrada nesta campanha.');
    const me = await this.users.findOneByOrFail({ id: user.id });
    const d = await this.deliveries.save(this.deliveries.create({
      ...dto, expenseId: dto.expenseId ?? null, unit: dto.unit ?? null, locationDetail: dto.locationDetail ?? null,
      responsibleName: dto.responsibleName ?? me.name, registeredBy: user.id, organizationId: org.id,
    }));
    await this.audit.log({ actor: user, action: 'DELIVERY_RECORDED', entityType: 'delivery_record', entityId: d.id, organizationId: org.id, metadata: { campaignId: d.campaignId, quantityPurchased: d.quantityPurchased, quantityDistributed: d.quantityDistributed }, ip });
    return d;
  }

  async listDeliveriesMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    return this.deliveries.find({ where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
  }

  // ---------- Evidências (ONG) ----------

  async uploadEvidence(user: RequestUser, dto: UploadEvidenceDto, file: Express.Multer.File | undefined, ip?: string) {
    const org = await this.orgs.approvedOfOwner(user.id);
    if (!dto.campaignId && !dto.deliveryRecordId) throw new BadRequestException('Vincule a evidência a uma campanha ou a um registro de entrega.');
    this.checkDate(dto.takenAt);
    let campaignId = dto.campaignId ?? null;
    if (dto.deliveryRecordId) {
      const d = await this.deliveries.findOneBy({ id: dto.deliveryRecordId, organizationId: org.id });
      if (!d) throw new NotFoundException('Registro de entrega não encontrado.');
      campaignId = d.campaignId;
    } else if (!(await this.campaigns.existsBy({ id: campaignId!, organizationId: org.id }))) throw new NotFoundException('Campanha não encontrada.');

    const data = prepareFile(file);
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(data.mime)) throw new BadRequestException('Evidências: JPG, PNG ou PDF.');
    // Fotos perdem EXIF/GPS antes de serem guardadas; o hash é do arquivo efetivamente armazenado.
    const content = stripImageMetadata(data.content, data.mime);
    const me = await this.users.findOneByOrFail({ id: user.id });
    const ev = await this.evidences.save(this.evidences.create({
      ...data, content, size: content.length, sha256: createHash('sha256').update(content).digest('hex'),
      organizationId: org.id, kind: dto.kind, description: dto.description, takenAt: dto.takenAt, campaignId, deliveryRecordId: dto.deliveryRecordId ?? null,
      responsibleName: me.name, uploadedBy: user.id, status: AccStatus.ENVIADA,
    }));
    await this.audit.log({ actor: user, action: 'EVIDENCE_UPLOADED', entityType: 'delivery_evidence', entityId: ev.id, organizationId: org.id, metadata: { kind: dto.kind, campaignId, deliveryRecordId: dto.deliveryRecordId ?? null, sha256: ev.sha256 }, ip });
    const { content: _c, ...meta } = ev;
    return meta;
  }

  async updateEvidence(user: RequestUser, id: string, dto: UpdateEvidenceDto, ip?: string) {
    const org = await this.orgs.approvedOfOwner(user.id);
    const ev = await this.evidences.findOne({ select: { ...FILE_COLS, description: true, takenAt: true }, where: { id, organizationId: org.id } });
    if (!ev) throw new NotFoundException(NOT_FOUND);
    if (!EDITABLE.includes(ev.status as AccStatus)) throw new BadRequestException('Evidência em análise ou já decidida não pode ser alterada.');
    if (dto.takenAt) this.checkDate(dto.takenAt);
    // Corrigir uma evidência com pedido de complementação a devolve para a fila.
    await this.evidences.update(id, { ...dto, status: AccStatus.ENVIADA, reviewReason: null });
    await this.audit.log({ actor: user, action: 'EVIDENCE_UPDATED', entityType: 'delivery_evidence', entityId: id, organizationId: org.id, metadata: { fields: Object.keys(dto) }, ip });
    return this.evidences.findOne({ select: { ...FILE_COLS, kind: true, description: true, takenAt: true }, where: { id } });
  }

  async listEvidencesMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    return this.evidences.find({ select: { ...FILE_COLS, kind: true, description: true, takenAt: true, campaignId: true, deliveryRecordId: true, responsibleName: true, publishable: true }, where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
  }

  async evidenceFile(user: RequestUser, id: string) {
    const ev = await this.evidences.findOne({ where: { id }, select: { ...FILE_COLS, content: true } });
    return this.visibleTo(user, ev);
  }

  // ---------- Administração ----------

  /** Fila de análise: tudo que está ENVIADA ou EM_ANALISE, mais antigo primeiro. */
  async queue() {
    const open = [AccStatus.ENVIADA, AccStatus.EM_ANALISE];
    const [expenses, evidences] = await Promise.all([
      this.expenses.find({ where: { status: In(open) }, relations: { campaign: { organization: true } }, order: { createdAt: 'ASC' } }),
      this.evidences.find({ select: { ...FILE_COLS, kind: true, description: true, takenAt: true, campaignId: true, deliveryRecordId: true, responsibleName: true }, where: { status: In(open) }, order: { createdAt: 'ASC' } }),
    ]);
    return {
      expenses: expenses.map((e) => ({ ...e, campaignTitle: e.campaign.title, organizationName: e.campaign.organization.tradeName ?? e.campaign.organization.legalName, campaign: undefined })),
      evidences,
    };
  }

  async expenseDetail(id: string) {
    const e = await this.expenses.findOne({ where: { id }, relations: { campaign: { organization: true } } });
    if (!e) throw new NotFoundException(NOT_FOUND);
    const documents = await this.expenseDocs.find({ select: { ...FILE_COLS, kind: true, publishable: true }, where: { expenseId: id }, order: { createdAt: 'DESC' } });
    return { ...e, campaignTitle: e.campaign.title, organizationName: e.campaign.organization.tradeName ?? e.campaign.organization.legalName, campaign: undefined, documents, financials: await this.financials(e.organizationId, e.campaignId) };
  }

  async evidenceDetail(id: string) {
    const ev = await this.evidences.findOne({ select: { ...FILE_COLS, kind: true, description: true, takenAt: true, campaignId: true, deliveryRecordId: true, responsibleName: true, publishable: true }, where: { id } });
    if (!ev) throw new NotFoundException(NOT_FOUND);
    return { ...ev, delivery: ev.deliveryRecordId ? await this.deliveries.findOneBy({ id: ev.deliveryRecordId }) : null };
  }

  private async decide<T extends { status: string }>(admin: RequestUser, current: T, dto: ReviewActionDto) {
    if (needsReason(dto.action) && !dto.reason) throw new BadRequestException('Informe o motivo/a complementação solicitada.');
    return nextStatus(current.status, dto.action);
  }

  async reviewExpense(admin: RequestUser, id: string, dto: ReviewActionDto, ip?: string) {
    const e = await this.expenses.findOneBy({ id });
    if (!e) throw new NotFoundException(NOT_FOUND);
    const status = await this.decide(admin, e, dto);
    if (dto.action === 'APROVAR') {
      // Só aprova com comprovante aprovado e dentro do saldo realmente arrecadado da campanha.
      if (!(await this.expenseDocs.countBy({ expenseId: id, status: AccStatus.APROVADA }))) throw new BadRequestException('Aprove ao menos um comprovante antes de aprovar a despesa.');
      const f = await this.financials(e.organizationId, e.campaignId);
      if (e.amountCents > f.balanceCents) throw new BadRequestException(`Despesa (${e.amountCents}) excede o saldo arrecadado disponível da campanha (${f.balanceCents}), em centavos.`);
    }
    const action = { INICIAR: 'EXPENSE_REVIEW_STARTED', APROVAR: 'EXPENSE_APPROVED', REPROVAR: 'EXPENSE_REJECTED', COMPLEMENTAR: 'EXPENSE_COMPLEMENT_REQUESTED' }[dto.action];
    await this.dataSource.transaction(async (m) => {
      await m.update(Expense, id, { status, reviewedBy: admin.id, reviewedAt: new Date(), reviewReason: dto.reason ?? null });
      await this.audit.log({ actor: admin, action, entityType: 'expense', entityId: id, organizationId: e.organizationId, metadata: { reason: dto.reason ?? null, amountCents: e.amountCents }, ip }, m);
    });
    return { id, status };
  }

  async reviewExpenseDocument(admin: RequestUser, id: string, dto: ReviewActionDto, ip?: string) {
    const doc = await this.expenseDocs.findOne({ where: { id }, select: { ...FILE_COLS, kind: true } });
    if (!doc) throw new NotFoundException(NOT_FOUND);
    const status = await this.decide(admin, doc, dto);
    await this.dataSource.transaction(async (m) => {
      await m.update(ExpenseDocument, id, { status, reviewedBy: admin.id, reviewedAt: new Date(), reviewReason: dto.reason ?? null, publishable: dto.action === 'APROVAR' ? !!dto.publishable : false });
      await this.audit.log({ actor: admin, action: 'EXPENSE_DOCUMENT_REVIEWED', entityType: 'expense_document', entityId: id, organizationId: doc.organizationId, metadata: { status, publishable: !!dto.publishable, reason: dto.reason ?? null }, ip }, m);
    });
    return { id, status };
  }

  async reviewEvidence(admin: RequestUser, id: string, dto: ReviewActionDto, ip?: string) {
    const ev = await this.evidences.findOne({ where: { id }, select: FILE_COLS });
    if (!ev) throw new NotFoundException(NOT_FOUND);
    const status = await this.decide(admin, ev, dto);
    await this.dataSource.transaction(async (m) => {
      await m.update(DeliveryEvidence, id, { status, reviewedBy: admin.id, reviewedAt: new Date(), reviewReason: dto.reason ?? null, publishable: dto.action === 'APROVAR' ? !!dto.publishable : false });
      await this.audit.log({ actor: admin, action: 'EVIDENCE_REVIEWED', entityType: 'delivery_evidence', entityId: id, organizationId: ev.organizationId, metadata: { status, publishable: !!dto.publishable, reason: dto.reason ?? null }, ip }, m);
    });
    return { id, status };
  }

  /** Admin vê tudo; ONG só os arquivos da própria organização (404 caso contrário). */
  private async visibleTo<T extends { organizationId: string }>(user: RequestUser, file: T | null): Promise<T> {
    if (!file) throw new NotFoundException(NOT_FOUND);
    if (user.type !== UserType.ADMIN) {
      const org = await this.orgs.ofOwner(user.id);
      if (file.organizationId !== org.id) throw new NotFoundException(NOT_FOUND);
    }
    return file;
  }
}
