import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { prepareFile } from '../common/file-upload';
import type { RequestUser } from '../common/request-context';
import { ReviewStatus } from '../common/stored-file.base';
import { ReviewDto } from '../organizations/organizations.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { UserType } from '../users/entities/user.entity';
import type { CreateDeliveryDto, CreateExpenseDto } from './accountability.dto';
import { DeliveryEvidence, DeliveryRecord } from './entities/delivery.entity';
import { Expense, ExpenseDocument } from './entities/expense.entity';

const FILE_COLS = { id: true, organizationId: true, name: true, mime: true, size: true, sha256: true, status: true, reviewReason: true, reviewedAt: true, createdAt: true } as const;
const NOT_FOUND = 'Registro não encontrado.';

@Injectable()
export class AccountabilityService {
  constructor(
    @InjectRepository(Expense) private expenses: Repository<Expense>,
    @InjectRepository(ExpenseDocument) private expenseDocs: Repository<ExpenseDocument>,
    @InjectRepository(DeliveryRecord) private deliveries: Repository<DeliveryRecord>,
    @InjectRepository(DeliveryEvidence) private evidences: Repository<DeliveryEvidence>,
    @InjectRepository(Campaign) private campaigns: Repository<Campaign>,
    @InjectDataSource() private dataSource: DataSource,
    private orgs: OrganizationsService,
    private audit: AuditService,
  ) {}

  /** Garante que a campanha pertence à ONG logada (e que a ONG está aprovada). */
  private async ownCampaign(userId: number, campaignId: string) {
    const org = await this.orgs.approvedOfOwner(userId);
    const c = await this.campaigns.findOneBy({ id: campaignId, organizationId: org.id });
    if (!c) throw new NotFoundException('Campanha não encontrada.');
    return org;
  }

  // ---------- Despesas ----------

  async createExpense(user: RequestUser, dto: CreateExpenseDto, ip?: string) {
    const org = await this.ownCampaign(user.id, dto.campaignId);
    const e = await this.expenses.save(this.expenses.create({ ...dto, organizationId: org.id }));
    await this.audit.log({ actor: user, action: 'EXPENSE_CREATED', entityType: 'expense', entityId: e.id, organizationId: org.id, metadata: { amountCents: e.amountCents, campaignId: e.campaignId }, ip });
    return e;
  }

  async listExpensesMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    return this.expenses.find({ where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
  }

  private async ownExpense(userId: number, id: string) {
    const org = await this.orgs.approvedOfOwner(userId);
    const e = await this.expenses.findOneBy({ id, organizationId: org.id });
    if (!e) throw new NotFoundException(NOT_FOUND);
    return e;
  }

  async uploadExpenseDocument(user: RequestUser, expenseId: string, file: Express.Multer.File | undefined, ip?: string) {
    const e = await this.ownExpense(user.id, expenseId);
    if (e.status === ReviewStatus.APROVADO) throw new BadRequestException('Despesa já aprovada.');
    const data = prepareFile(file);
    const doc = await this.expenseDocs.save(this.expenseDocs.create({ ...data, organizationId: e.organizationId, expenseId, uploadedBy: user.id }));
    await this.audit.log({ actor: user, action: 'EXPENSE_DOCUMENT_UPLOADED', entityType: 'expense_document', entityId: doc.id, organizationId: e.organizationId, metadata: { expenseId, sha256: data.sha256 }, ip });
    const { content, ...meta } = doc;
    return meta;
  }

  async listExpenseDocuments(user: RequestUser, expenseId: string) {
    const org = user.type === UserType.ADMIN ? null : await this.orgs.ofOwner(user.id);
    const e = await this.expenses.findOneBy(org ? { id: expenseId, organizationId: org.id } : { id: expenseId });
    if (!e) throw new NotFoundException(NOT_FOUND);
    return this.expenseDocs.find({ select: FILE_COLS, where: { expenseId }, order: { createdAt: 'DESC' } });
  }

  async expenseDocumentFile(user: RequestUser, id: string) {
    const doc = await this.expenseDocs.findOne({ where: { id }, select: { ...FILE_COLS, content: true } });
    return this.visibleTo(user, doc);
  }

  listPendingExpenses() {
    return this.expenses.find({ where: { status: ReviewStatus.PENDENTE }, order: { createdAt: 'ASC' } });
  }

  async reviewExpenseDocument(admin: RequestUser, id: string, dto: ReviewDto, ip?: string) {
    const doc = await this.expenseDocs.findOne({ where: { id }, select: FILE_COLS });
    if (!doc) throw new NotFoundException(NOT_FOUND);
    const status = dto.decision === 'APROVAR' ? ReviewStatus.APROVADO : ReviewStatus.REPROVADO;
    await this.dataSource.transaction(async (m) => {
      await m.update(ExpenseDocument, id, { status, reviewedBy: admin.id, reviewedAt: new Date(), reviewReason: dto.reason ?? null });
      await this.audit.log({ actor: admin, action: 'EXPENSE_DOCUMENT_REVIEWED', entityType: 'expense_document', entityId: id, organizationId: doc.organizationId, metadata: { status, reason: dto.reason ?? null }, ip }, m);
    });
    return { id, status };
  }

  async reviewExpense(admin: RequestUser, id: string, dto: ReviewDto, ip?: string) {
    const e = await this.expenses.findOneBy({ id });
    if (!e) throw new NotFoundException(NOT_FOUND);
    if (e.status !== ReviewStatus.PENDENTE) throw new BadRequestException('Despesa já analisada.');
    const approve = dto.decision === 'APROVAR';
    if (approve && !(await this.expenseDocs.countBy({ expenseId: id, status: ReviewStatus.APROVADO }))) {
      throw new BadRequestException('Aprove ao menos um comprovante antes de aprovar a despesa.');
    }
    const status = approve ? ReviewStatus.APROVADO : ReviewStatus.REPROVADO;
    await this.dataSource.transaction(async (m) => {
      await m.update(Expense, id, { status, reviewedBy: admin.id, reviewReason: dto.reason ?? null });
      await this.audit.log({ actor: admin, action: approve ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED', entityType: 'expense', entityId: id, organizationId: e.organizationId, metadata: { reason: dto.reason ?? null }, ip }, m);
    });
    return { id, status };
  }

  // ---------- Entregas ----------

  async createDelivery(user: RequestUser, dto: CreateDeliveryDto, ip?: string) {
    const org = await this.ownCampaign(user.id, dto.campaignId);
    const d = await this.deliveries.save(this.deliveries.create({ ...dto, quantity: dto.quantity ?? null, unit: dto.unit ?? null, organizationId: org.id }));
    await this.audit.log({ actor: user, action: 'DELIVERY_RECORDED', entityType: 'delivery_record', entityId: d.id, organizationId: org.id, metadata: { campaignId: d.campaignId }, ip });
    return d;
  }

  async listDeliveriesMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    return this.deliveries.find({ where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
  }

  async uploadEvidence(user: RequestUser, deliveryId: string, file: Express.Multer.File | undefined, ip?: string) {
    const org = await this.orgs.approvedOfOwner(user.id);
    const d = await this.deliveries.findOneBy({ id: deliveryId, organizationId: org.id });
    if (!d) throw new NotFoundException(NOT_FOUND);
    const data = prepareFile(file);
    const ev = await this.evidences.save(this.evidences.create({ ...data, organizationId: org.id, deliveryRecordId: deliveryId, uploadedBy: user.id }));
    await this.audit.log({ actor: user, action: 'EVIDENCE_UPLOADED', entityType: 'delivery_evidence', entityId: ev.id, organizationId: org.id, metadata: { deliveryId, sha256: data.sha256 }, ip });
    const { content, ...meta } = ev;
    return meta;
  }

  async evidenceFile(user: RequestUser, id: string) {
    const ev = await this.evidences.findOne({ where: { id }, select: { ...FILE_COLS, content: true } });
    return this.visibleTo(user, ev);
  }

  listPendingEvidences() {
    return this.evidences.find({ select: FILE_COLS, where: { status: ReviewStatus.PENDENTE }, order: { createdAt: 'ASC' } });
  }

  async reviewEvidence(admin: RequestUser, id: string, dto: ReviewDto, ip?: string) {
    const ev = await this.evidences.findOne({ where: { id }, select: FILE_COLS });
    if (!ev) throw new NotFoundException(NOT_FOUND);
    const status = dto.decision === 'APROVAR' ? ReviewStatus.APROVADO : ReviewStatus.REPROVADO;
    await this.dataSource.transaction(async (m) => {
      await m.update(DeliveryEvidence, id, { status, reviewedBy: admin.id, reviewedAt: new Date(), reviewReason: dto.reason ?? null });
      await this.audit.log({ actor: admin, action: 'EVIDENCE_REVIEWED', entityType: 'delivery_evidence', entityId: id, organizationId: ev.organizationId, metadata: { status, reason: dto.reason ?? null }, ip }, m);
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
