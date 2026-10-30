import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign, CampaignStatus } from '../campaigns/entities/campaign.entity';
import { AccStatus } from '../common/accountability-status';
import { redactPII } from '../common/redact';
import { Organization, OrganizationStatus } from '../organizations/entities/organization.entity';
import { onlyDigits } from '../organizations/cnpj.util';
import { AccountabilityService } from './accountability.service';
import { DeliveryEvidence, DeliveryRecord } from './entities/delivery.entity';
import { Expense, ExpenseDocument } from './entities/expense.entity';

const FILE_COLS = { id: true, organizationId: true, name: true, mime: true, content: true } as const;

/**
 * Perfil público de transparência. Regras de proteção:
 *  - só ONG APROVADA; só despesas APROVADAS; só arquivos APROVADOS **e** marcados como publicáveis pelo admin;
 *  - nunca expõe CPF/CNPJ de fornecedor, nomes de arquivo, detalhe do local, responsável ou beneficiários;
 *  - fornecedor pessoa física é anonimizado; textos livres passam por máscara de CPF/e-mail/telefone.
 */
@Injectable()
export class TransparencyService {
  constructor(
    @InjectRepository(Organization) private orgs: Repository<Organization>,
    @InjectRepository(Campaign) private campaigns: Repository<Campaign>,
    @InjectRepository(Expense) private expenses: Repository<Expense>,
    @InjectRepository(ExpenseDocument) private docs: Repository<ExpenseDocument>,
    @InjectRepository(DeliveryRecord) private deliveries: Repository<DeliveryRecord>,
    @InjectRepository(DeliveryEvidence) private evidences: Repository<DeliveryEvidence>,
    private acc: AccountabilityService,
  ) {}

  private async publicOrg(id: string) {
    const org = await this.orgs.findOneBy({ id, status: OrganizationStatus.APROVADA });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    return org;
  }

  async profile(id: string) {
    const org = await this.publicOrg(id);
    const camps = (await this.campaigns.find({ where: { organizationId: id }, order: { createdAt: 'DESC' } })).filter((c) => c.status !== CampaignStatus.RASCUNHO);
    const expenses = await this.expenses.find({ where: { organizationId: id, status: AccStatus.APROVADA }, order: { spentAt: 'DESC' } });
    const docs = await this.docs.find({ select: { id: true, expenseId: true, kind: true }, where: { organizationId: id, status: AccStatus.APROVADA, publishable: true } });
    const evs = await this.evidences.find({ select: { id: true, kind: true, description: true, takenAt: true, deliveryRecordId: true, campaignId: true, mime: true }, where: { organizationId: id, status: AccStatus.APROVADA, publishable: true }, order: { takenAt: 'DESC' } });
    const approvedDeliveryIds = new Set((await this.evidences.find({ select: { deliveryRecordId: true }, where: { organizationId: id, status: AccStatus.APROVADA } })).map((e) => e.deliveryRecordId).filter(Boolean));
    const deliveries = (await this.deliveries.find({ where: { organizationId: id }, order: { deliveredAt: 'DESC' } })).filter((d) => approvedDeliveryIds.has(d.id));
    const title = new Map(camps.map((c) => [c.id, c.title]));

    return {
      organization: { id: org.id, name: org.tradeName ?? org.legalName, legalName: org.legalName, cnpj: org.cnpj, description: redactPII(org.description), city: org.city, state: org.state, validatedAt: org.reviewedAt },
      totals: await this.acc.financials(id),
      campaigns: await Promise.all(camps.map(async (c) => ({ id: c.id, title: c.title, status: c.status, goalCents: c.goalCents, ...(await this.acc.financials(id, c.id)) }))),
      expenses: expenses.map((e) => ({
        id: e.id, date: e.spentAt, category: e.category, description: redactPII(e.description), amountCents: e.amountCents, campaignTitle: title.get(e.campaignId) ?? null,
        // CPF (11 dígitos) = pessoa física: identidade protegida.
        supplier: e.supplier ? (onlyDigits(e.supplierDocument).length === 11 ? 'Pessoa física (identidade protegida)' : redactPII(e.supplier)) : null,
        documents: docs.filter((d) => d.expenseId === e.id).map((d) => ({ id: d.id, kind: d.kind })),
      })),
      deliveries: deliveries.map((d) => ({
        id: d.id, date: d.deliveredAt, item: redactPII(d.itemDescription), quantityPurchased: d.quantityPurchased, quantityDistributed: d.quantityDistributed, unit: d.unit,
        region: d.region, description: redactPII(d.description), campaignTitle: title.get(d.campaignId) ?? null,
        evidences: evs.filter((e) => e.deliveryRecordId === d.id).map((e) => ({ id: e.id, kind: e.kind, mime: e.mime, description: redactPII(e.description), date: e.takenAt })),
      })),
      campaignEvidences: evs.filter((e) => !e.deliveryRecordId).map((e) => ({ id: e.id, kind: e.kind, mime: e.mime, description: redactPII(e.description), date: e.takenAt, campaignTitle: title.get(e.campaignId!) ?? null })),
      notice: 'Os valores são calculados automaticamente a partir dos registros; documentos e evidências só aparecem após análise da plataforma.',
    };
  }

  async publicExpenseDocument(id: string) {
    const d = await this.docs.findOne({ select: FILE_COLS, where: { id, status: AccStatus.APROVADA, publishable: true } });
    if (!d) throw new NotFoundException('Arquivo não encontrado.');
    await this.publicOrg(d.organizationId);
    return { ...d, name: `comprovante-${d.id.slice(0, 8)}${d.mime === 'application/pdf' ? '.pdf' : '.jpg'}` };
  }

  async publicEvidence(id: string) {
    const e = await this.evidences.findOne({ select: FILE_COLS, where: { id, status: AccStatus.APROVADA, publishable: true } });
    if (!e) throw new NotFoundException('Arquivo não encontrado.');
    await this.publicOrg(e.organizationId);
    const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[e.mime] ?? 'bin';
    return { ...e, name: `evidencia-${e.id.slice(0, 8)}.${ext}` };
  }
}
