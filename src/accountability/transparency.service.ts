import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { Campaign, CampaignStatus } from '../campaigns/entities/campaign.entity';
import { AccStatus } from '../common/accountability-status';
import { redactPII } from '../common/redact';
import { ReviewStatus } from '../common/stored-file.base';
import { Donation, DonationStatus } from '../donations/entities/donation.entity';
import { OrganizationDocument } from '../organizations/entities/organization-document.entity';
import { CheckSource, CheckStatus, OrganizationExternalCheck } from '../organizations/entities/organization-external-check.entity';
import { Organization, OrganizationStatus } from '../organizations/entities/organization.entity';
import { onlyDigits } from '../organizations/cnpj.util';
import { AccountabilityService } from './accountability.service';
import { DeliveryEvidence, DeliveryRecord } from './entities/delivery.entity';
import { Expense, ExpenseDocument } from './entities/expense.entity';

const FILE_COLS = { id: true, organizationId: true, name: true, mime: true, content: true } as const;

/**
 * Classes de procedência. Cada informação do perfil público carrega a(s) classe(s) que
 * explicam de onde ela vem — o doador avalia; a plataforma não resume isso em selo ou nota.
 */
export const PROVENANCE = {
  DECLARADA: { label: 'Declarada pela ONG', description: 'Informada pela própria instituição; não foi verificada de forma independente.' },
  FONTE_EXTERNA: { label: 'Consultada em fonte externa', description: 'Obtida de base pública ou do provedor de pagamentos no momento da consulta, com fonte e data.' },
  DOCUMENTO_RECEBIDO: { label: 'Documento recebido', description: 'A plataforma recebeu um documento que sustenta a informação; ele ainda pode não ter sido analisado.' },
  DOCUMENTO_ANALISADO: { label: 'Documento analisado', description: 'Um administrador analisou o documento e o aprovou.' },
  EVIDENCIA_APROVADA: { label: 'Evidência aprovada', description: 'Foto ou relatório analisado e aprovado por um administrador.' },
  AUDITORIA: { label: 'Registrado na auditoria', description: 'Há registro imutável da ação (quem, quando e o quê) na trilha de auditoria da plataforma.' },
} as const;
type Prov = keyof typeof PROVENANCE;

const SOURCE_LABEL: Record<CheckSource, string> = {
  [CheckSource.BRASILAPI]: 'Cadastro de CNPJ na Receita Federal (via BrasilAPI)',
  [CheckSource.MAPA_OSC]: 'Mapa das Organizações da Sociedade Civil (IPEA)',
  [CheckSource.PORTAL_TRANSPARENCIA]: 'Portal da Transparência — sanções CEIS, CNEP e CEPIM',
  [CheckSource.TRANSFEREGOV]: 'Transferegov — parcerias públicas',
};
// Texto neutro por resultado: sem detalhes brutos da consulta e sem inferir "irregularidade".
const RESULT_LABEL: Record<CheckStatus, string> = {
  [CheckStatus.OK]: 'Consultada sem apontamentos',
  [CheckStatus.ALERTA]: 'Consulta apontou pontos que foram analisados pela equipe de validação',
  [CheckStatus.NAO_ENCONTRADO]: 'Sem registro nesta base (ausência neutra; não indica irregularidade)',
  [CheckStatus.INDISPONIVEL]: 'Fonte indisponível na consulta',
};
const DOC_LABEL: Record<string, string> = {
  ESTATUTO: 'Estatuto social', ATA_DIRETORIA: 'Ata de eleição e posse da diretoria', COMPROVANTE_ENDERECO: 'Comprovante de endereço institucional',
  DOC_REPRESENTANTE: 'Documento de identificação do representante legal', CARTAO_CNPJ: 'Cartão CNPJ', CERTIDAO: 'Certidão', OUTRO: 'Outro documento',
};

export interface TimelineEvent { type: string; at: Date | string; title: string; detail?: string; campaignTitle?: string | null; provenance: Prov[] }

/**
 * Perfil público de transparência. Proteções:
 *  - só ONG APROVADA; só despesas APROVADAS; só arquivos APROVADOS **e** marcados como publicáveis pelo admin;
 *  - nunca expõe documentos institucionais, CPF/CNPJ de fornecedor, nomes de arquivo, detalhe do local, responsável, doadores ou beneficiários;
 *  - evidências pendentes/reprovadas aparecem só como contagem, nunca como conteúdo;
 *  - textos livres passam por máscara de CPF/e-mail/telefone.
 */
@Injectable()
export class TransparencyService {
  constructor(
    @InjectRepository(Organization) private orgs: Repository<Organization>,
    @InjectRepository(OrganizationDocument) private orgDocs: Repository<OrganizationDocument>,
    @InjectRepository(OrganizationExternalCheck) private checks: Repository<OrganizationExternalCheck>,
    @InjectRepository(Campaign) private campaigns: Repository<Campaign>,
    @InjectRepository(Donation) private donations: Repository<Donation>,
    @InjectRepository(Expense) private expenses: Repository<Expense>,
    @InjectRepository(ExpenseDocument) private docs: Repository<ExpenseDocument>,
    @InjectRepository(DeliveryRecord) private deliveries: Repository<DeliveryRecord>,
    @InjectRepository(DeliveryEvidence) private evidences: Repository<DeliveryEvidence>,
    @InjectRepository(AuditLog) private auditLogs: Repository<AuditLog>,
    private acc: AccountabilityService,
  ) {}

  private async publicOrg(id: string) {
    const org = await this.orgs.findOneBy({ id, status: OrganizationStatus.APROVADA });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    return org;
  }

  /** Última consulta de cada fonte (a mais recente por fonte). */
  private async latestChecks(organizationId: string) {
    const rows = await this.checks.find({ where: { organizationId }, order: { queriedAt: 'DESC' } });
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.source) ? false : (seen.add(r.source), true)));
  }

  async profile(id: string) {
    const org = await this.publicOrg(id);
    const [checks, orgDocs, allCamps, expenses, expDocs, evAll, deliveries, orgAudit] = await Promise.all([
      this.latestChecks(id),
      this.orgDocs.find({ select: { id: true, type: true, status: true, createdAt: true, reviewedAt: true }, where: { organizationId: id }, order: { createdAt: 'ASC' } }),
      this.campaigns.find({ where: { organizationId: id }, order: { createdAt: 'DESC' } }),
      this.expenses.find({ where: { organizationId: id, status: AccStatus.APROVADA }, order: { spentAt: 'DESC' } }),
      this.docs.find({ select: { id: true, expenseId: true, kind: true, status: true, publishable: true }, where: { organizationId: id } }),
      this.evidences.find({ select: { id: true, kind: true, description: true, takenAt: true, deliveryRecordId: true, campaignId: true, mime: true, status: true, publishable: true, reviewedAt: true }, where: { organizationId: id }, order: { takenAt: 'DESC' } }),
      this.deliveries.find({ where: { organizationId: id }, order: { deliveredAt: 'DESC' } }),
      this.auditLogs.find({ select: { action: true, entityType: true, entityId: true, createdAt: true }, where: { organizationId: id }, order: { createdAt: 'ASC' } }),
    ]);

    const camps = allCamps.filter((c) => c.status !== CampaignStatus.RASCUNHO);
    const campTitle = new Map(allCamps.map((c) => [c.id, c.title]));
    const approvedEvidences = evAll.filter((e) => e.status === AccStatus.APROVADA);
    const publishedEvidences = approvedEvidences.filter((e) => e.publishable);
    const verifiedDeliveryIds = new Set(approvedEvidences.map((e) => e.deliveryRecordId).filter(Boolean));
    const verifiedDeliveries = deliveries.filter((d) => verifiedDeliveryIds.has(d.id));
    const expenseById = new Map(expenses.map((e) => [e.id, e]));
    const publicDocs = expDocs.filter((d) => d.status === AccStatus.APROVADA && d.publishable);
    const analyzedDocsByExpense = (eid: string) => expDocs.filter((d) => d.expenseId === eid && d.status === AccStatus.APROVADA).length;
    const supplierOf = (e: Expense) => (e.supplier ? (onlyDigits(e.supplierDocument).length === 11 ? 'Pessoa física (identidade protegida)' : redactPII(e.supplier)) : null);

    // ---- Identificação e validação ----
    const approvedAudit = [...orgAudit].reverse().find((l) => l.action === 'ORG_APPROVED');
    const validatedAt = approvedAudit?.createdAt ?? org.reviewedAt;
    const receitaCheck = checks.find((c) => c.source === CheckSource.BRASILAPI && c.data);
    const r: any = receitaCheck?.data ?? {};
    const lastCheckedAt = checks.length ? checks.reduce((m, c) => (c.queriedAt > m ? c.queriedAt : m), checks[0].queriedAt) : null;
    const count = (...a: string[]) => orgAudit.filter((l) => a.includes(l.action)).length;
    const lastReviewAt = orgAudit.filter((l) => /REVIEWED|APPROVED|REJECTED|COMPLEMENT/.test(l.action)).pop()?.createdAt ?? null;

    const identification = {
      id: org.id, name: org.tradeName ?? org.legalName, legalName: org.legalName, cnpj: org.cnpj,
      description: redactPII(org.description), city: org.city, state: org.state, registeredAt: org.createdAt,
      provenance: ['DECLARADA'] as Prov[],
    };
    const validation = {
      status: 'APROVADA', validatedAt, lastCheckedAt,
      statusNote: 'A aprovação indica que a instituição passou pela análise da plataforma nas etapas abaixo. Não é garantia de resultado nem nota de confiança.',
      // Informações institucionais conferidas, com a classe de cada uma.
      receita: receitaCheck ? { situacaoCadastral: r.situacao_cadastral ?? null, naturezaJuridica: r.natureza_juridica ?? null, cnaePrincipal: r.cnae_fiscal_descricao ?? null, inicioAtividade: r.data_inicio_atividade ?? null, municipio: r.municipio ?? null, uf: r.uf ?? null, queriedAt: receitaCheck.queriedAt, provenance: ['FONTE_EXTERNA'] as Prov[] } : null,
      sources: checks.map((c) => ({ source: c.source, label: SOURCE_LABEL[c.source], result: c.status, resultLabel: RESULT_LABEL[c.status], queriedAt: c.queriedAt, provenance: ['FONTE_EXTERNA'] as Prov[] })),
      // Documentos institucionais: só tipo, data de recebimento e situação — o conteúdo nunca é público.
      documents: orgDocs.filter((d) => !d.supersededAt).map((d) => ({
        type: d.type, label: DOC_LABEL[d.type] ?? d.type, receivedAt: d.createdAt,
        state: d.status === ReviewStatus.APROVADO ? 'ANALISADO_APROVADO' : d.status === ReviewStatus.REPROVADO ? 'ANALISADO_REPROVADO' : 'RECEBIDO',
        analyzedAt: d.status === ReviewStatus.PENDENTE ? null : d.reviewedAt,
        provenance: [d.status === ReviewStatus.PENDENTE ? 'DOCUMENTO_RECEBIDO' : 'DOCUMENTO_ANALISADO'] as Prov[],
      })),
    };
    const audit = {
      provenance: ['AUDITORIA'] as Prov[],
      validationRecordedAt: approvedAudit?.createdAt ?? null,
      documentsReviewed: count('ORG_DOCUMENT_REVIEWED'),
      expenseReviews: count('EXPENSE_APPROVED', 'EXPENSE_REJECTED', 'EXPENSE_COMPLEMENT_REQUESTED'),
      evidenceReviews: count('EVIDENCE_REVIEWED'),
      lastReviewAt,
      note: 'Contagem de análises registradas na trilha de auditoria da plataforma (imutável).',
    };

    // ---- Financeiro por campanha ----
    const campaigns = await Promise.all(camps.map(async (c) => {
      const f = await this.acc.financials(id, c.id);
      const campExpenses = expenses.filter((e) => e.campaignId === c.id);
      return {
        id: c.id, title: c.title, status: c.status, goalCents: c.goalCents, startsAt: c.startsAt, endsAt: c.endsAt,
        ...f,
        // Calculado, nunca informado: arrecadado confirmado ÷ meta.
        percentReached: c.goalCents > 0 ? Math.round((f.totalRaisedCents / c.goalCents) * 1000) / 10 : 0,
        expenses: campExpenses.map((e) => ({ id: e.id, date: e.spentAt, category: e.category, description: redactPII(e.description), amountCents: e.amountCents })),
        provenance: ['FONTE_EXTERNA', 'DOCUMENTO_ANALISADO'] as Prov[],
      };
    }));

    // ---- Despesas aprovadas / comprovantes ----
    const expensesOut = expenses.map((e) => ({
      id: e.id, campaignId: e.campaignId, date: e.spentAt, category: e.category, description: redactPII(e.description), amountCents: e.amountCents,
      campaignTitle: campTitle.get(e.campaignId) ?? null, supplier: supplierOf(e), status: e.status, approvedAt: e.reviewedAt,
      documents: publicDocs.filter((d) => d.expenseId === e.id).map((d) => ({ id: d.id, kind: d.kind })),
      documentsAnalyzed: analyzedDocsByExpense(e.id),
      // explica por que não há arquivo: recebido e analisado, mas não publicado por segurança
      documentNote: publicDocs.some((d) => d.expenseId === e.id) ? null : analyzedDocsByExpense(e.id) ? 'Comprovante analisado pela plataforma; arquivo não publicado para proteger dados pessoais.' : null,
      provenance: (['DECLARADA', analyzedDocsByExpense(e.id) ? 'DOCUMENTO_ANALISADO' : 'DOCUMENTO_RECEBIDO'] as Prov[]),
    }));

    // ---- Galeria e entregas ----
    const evOut = (e: (typeof publishedEvidences)[number]) => ({
      id: e.id, kind: e.kind, mime: e.mime, description: redactPII(e.description), date: e.takenAt, status: e.status, approvedAt: e.reviewedAt,
      campaignId: e.campaignId, campaignTitle: e.campaignId ? campTitle.get(e.campaignId) ?? null : null, deliveryId: e.deliveryRecordId,
      provenance: ['EVIDENCIA_APROVADA'] as Prov[],
    });
    const deliveriesOut = verifiedDeliveries.map((d) => {
      const purchase = d.expenseId ? expenseById.get(d.expenseId) : undefined;
      return {
        id: d.id, date: d.deliveredAt, item: redactPII(d.itemDescription), quantityPurchased: d.quantityPurchased, quantityDistributed: d.quantityDistributed, unit: d.unit,
        region: d.region, description: redactPII(d.description), campaignTitle: campTitle.get(d.campaignId) ?? null,
        purchase: purchase ? { description: redactPII(purchase.description), amountCents: purchase.amountCents, date: purchase.spentAt } : null,
        evidences: publishedEvidences.filter((e) => e.deliveryRecordId === d.id).map(evOut),
        provenance: ['DECLARADA', 'EVIDENCIA_APROVADA'] as Prov[],
      };
    });
    const evidenceSummary = {
      published: publishedEvidences.length,
      approvedNotPublished: approvedEvidences.length - publishedEvidences.length,
      awaitingAnalysis: evAll.filter((e) => e.status === AccStatus.ENVIADA || e.status === AccStatus.EM_ANALISE).length,
      needsComplement: evAll.filter((e) => e.status === AccStatus.NECESSITA_COMPLEMENTACAO).length,
      note: 'Evidências em análise, com pedido de complementação ou reprovadas não são exibidas como comprovadas.',
    };

    // ---- Linha do tempo (somente de registros reais) ----
    const timeline: TimelineEvent[] = [];
    if (validatedAt) timeline.push({ type: 'ORG_VALIDATED', at: validatedAt, title: 'ONG validada pela plataforma', provenance: ['DOCUMENTO_ANALISADO', 'AUDITORIA'] });
    const published = new Map(orgAudit.filter((l) => l.action === 'CAMPAIGN_PUBLISHED').map((l) => [l.entityId, l.createdAt]));
    for (const c of camps) if (published.has(c.id)) timeline.push({ type: 'CAMPAIGN_PUBLISHED', at: published.get(c.id)!, title: 'Campanha publicada', detail: c.title, campaignTitle: c.title, provenance: ['AUDITORIA'] });
    const confirmed = camps.length ? await this.donations.find({ select: { campaignId: true, amountCents: true, confirmedAt: true }, where: { campaignId: In(camps.map((c) => c.id)), status: DonationStatus.CONFIRMADA } }) : [];
    const byDay = new Map<string, { n: number; sum: number; at: Date; campaignId: string }>();
    for (const d of confirmed) {
      const key = `${d.campaignId}|${d.confirmedAt!.toISOString().slice(0, 10)}`;
      const g = byDay.get(key) ?? { n: 0, sum: 0, at: d.confirmedAt!, campaignId: d.campaignId };
      g.n++; g.sum += d.amountCents; byDay.set(key, g);
    }
    // doações agregadas por campanha/dia: nenhuma identidade de doador
    for (const g of byDay.values()) timeline.push({ type: 'DONATIONS_RECEIVED', at: g.at, title: `${g.n} doação(ões) confirmada(s)`, detail: `Total do dia: ${(g.sum / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, campaignTitle: campTitle.get(g.campaignId), provenance: ['FONTE_EXTERNA'] });
    for (const e of expenses) {
      const t = campTitle.get(e.campaignId) ?? null;
      timeline.push({ type: 'PURCHASE_REGISTERED', at: e.spentAt, title: 'Compra registrada', detail: redactPII(e.description), campaignTitle: t, provenance: ['DECLARADA'] });
      timeline.push({ type: 'EXPENSE_SUBMITTED', at: e.createdAt, title: 'Prestação de contas enviada', detail: redactPII(e.description), campaignTitle: t, provenance: ['DECLARADA', 'DOCUMENTO_RECEBIDO'] });
      if (e.reviewedAt) timeline.push({ type: 'EXPENSE_APPROVED', at: e.reviewedAt, title: 'Prestação de contas aprovada', detail: redactPII(e.description), campaignTitle: t, provenance: [analyzedDocsByExpense(e.id) ? 'DOCUMENTO_ANALISADO' : 'DOCUMENTO_RECEBIDO', 'AUDITORIA'] });
    }
    for (const d of verifiedDeliveries) {
      const p = d.expenseId ? expenseById.get(d.expenseId) : undefined;
      if (p) timeline.push({ type: 'PRODUCTS_ACQUIRED', at: p.spentAt, title: 'Produtos adquiridos', detail: `${redactPII(d.itemDescription)} — ${d.quantityPurchased} ${d.unit ?? ''}`.trim(), campaignTitle: campTitle.get(d.campaignId), provenance: ['DECLARADA'] });
      timeline.push({ type: 'DELIVERY_REGISTERED', at: d.deliveredAt, title: 'Entrega registrada', detail: `${redactPII(d.itemDescription)} — ${d.quantityDistributed} ${d.unit ?? ''} em ${d.region}`.trim(), campaignTitle: campTitle.get(d.campaignId), provenance: ['DECLARADA', 'EVIDENCIA_APROVADA'] });
    }
    for (const e of publishedEvidences) if (e.reviewedAt) timeline.push({ type: 'EVIDENCE_APPROVED', at: e.reviewedAt, title: 'Evidência aprovada', detail: redactPII(e.description), campaignTitle: e.campaignId ? campTitle.get(e.campaignId) : null, provenance: ['EVIDENCIA_APROVADA', 'AUDITORIA'] });
    timeline.sort((a, b) => +new Date(b.at) - +new Date(a.at));

    return {
      organization: { ...identification, validatedAt },
      identification, validation, audit,
      totals: await this.acc.financials(id),
      campaigns,
      expenses: expensesOut,
      deliveries: deliveriesOut,
      deliveriesAwaitingVerification: deliveries.length - verifiedDeliveries.length,
      gallery: publishedEvidences.map(evOut),
      campaignEvidences: publishedEvidences.filter((e) => !e.deliveryRecordId).map(evOut),
      evidenceSummary,
      timeline: timeline.slice(0, 300),
      legend: PROVENANCE,
      notice: 'Valores calculados automaticamente a partir dos pagamentos confirmados e das despesas aprovadas. Documentos e evidências só aparecem após análise e quando podem ser publicados com segurança. Não há selo ou nota de confiança: avalie as informações e suas fontes.',
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
