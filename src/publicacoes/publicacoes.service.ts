import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';

import { Publicacao } from './entities/publicacao.entity';
import { AnexoKind, PublicacaoAnexo } from './entities/publicacao-anexo.entity';
import { PublicacoesQueryDto } from './dto/publicacoes-query.dto';
import { CreatePublicacaoDto } from './dto/create-publicacao.dto';
import { User, UserType, UserStatus } from '../users/entities/user.entity';
import { Organization, OrganizationStatus } from '../organizations/entities/organization.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Expense } from '../accountability/entities/expense.entity';
import { DeliveryEvidence, DeliveryRecord } from '../accountability/entities/delivery.entity';
import { AuditService } from '../audit/audit.service';
import { AccStatus, needsReason, nextStatus } from '../common/accountability-status';
import { detectImage } from '../common/file-upload';
import { stripImageMetadata } from '../common/sanitize';
import { nomeDocumento } from '../medalhas/medalha-branca.upload';
import type { RequestUser } from '../common/request-context';
import { ReviewActionDto } from '../accountability/accountability.dto';
import { CATEGORY_LABEL, Category, Classification, MAX_ANEXOS_POR_PUBLICACAO, MAX_ANEXO_BYTES } from './publicacoes.constants';
import { OrganizationsService } from '../organizations/organizations.service';
import { ContentReviewStatus, validateContentDecision, type ContentReviewDecision } from '../common/content-moderation';

const NOT_FOUND = 'Publicação não encontrada.';
const FILE_META = { id: true, publicacaoId: true, organizationId: true, kind: true, name: true, mime: true, size: true, sha256: true, status: true, imageConsent: true, publishable: true, reviewReason: true, reviewedAt: true, createdAt: true } as const;

/** Valida pelos bytes reais (nunca pelo MIME informado) e remove metadados (EXIF/GPS) das imagens. */
export function prepareAnexo(file?: Express.Multer.File): { kind: AnexoKind; name: string; mime: string; size: number; sha256: string; content: Buffer } {
  const buf = file?.buffer;
  if (!file || !buf?.length) throw new BadRequestException('Arquivo obrigatório.');
  if (buf.length > MAX_ANEXO_BYTES) throw new BadRequestException('O arquivo deve ter no máximo 5 MB.');
  const img = detectImage(buf);
  const isPdf = buf.subarray(0, 5).toString() === '%PDF-';
  if (!img && !isPdf) throw new BadRequestException('Envie JPG, PNG, WebP ou PDF válidos.');
  const mime = img ? img.mime : 'application/pdf';
  const content = img ? stripImageMetadata(buf, mime) : buf;
  return { kind: img ? 'IMAGEM' : 'DOCUMENTO', name: nomeDocumento(file.originalname), mime, size: content.length, sha256: createHash('sha256').update(content).digest('hex'), content };
}

@Injectable()
export class PublicacoesService {
  constructor(
    @InjectRepository(Publicacao) private readonly repo: Repository<Publicacao>,
    @InjectRepository(PublicacaoAnexo) private readonly anexos: Repository<PublicacaoAnexo>,
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectRepository(DeliveryRecord) private readonly deliveries: Repository<DeliveryRecord>,
    @InjectRepository(DeliveryEvidence) private readonly evidences: Repository<DeliveryEvidence>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationsService,
  ) {}

  // ---------- Criação (ONG) ----------

  private async activeOng(ongId: number) {
    const ong = await this.usersRepository.findOne({ where: { id: ongId, type: UserType.ONG, status: UserStatus.ATIVO }, select: ['id', 'name'] });
    if (!ong) throw new ForbiddenException('Somente uma ONG ativa pode criar publicações.');
    return ong;
  }

  /** Cada vínculo precisa ser registro REAL da própria organização aprovada; campanha é inferida do registro. */
  private async resolveLinks(org: Organization | null, dto: CreatePublicacaoDto) {
    const { campaignId, expenseId, deliveryRecordId } = dto;
    if (!campaignId && !expenseId && !deliveryRecordId) return { campaignId: null, expenseId: null, deliveryRecordId: null };
    if (!org || org.status !== OrganizationStatus.APROVADA) throw new ForbiddenException('Só organizações aprovadas podem vincular publicações à prestação de contas.');
    const expense = expenseId ? await this.expenses.findOneBy({ id: expenseId, organizationId: org.id }) : null;
    const delivery = deliveryRecordId ? await this.deliveries.findOneBy({ id: deliveryRecordId, organizationId: org.id }) : null;
    if (expenseId && !expense) throw new BadRequestException('Despesa não encontrada nesta organização.');
    if (deliveryRecordId && !delivery) throw new BadRequestException('Entrega não encontrada nesta organização.');
    const campaign = campaignId ? await this.campaigns.findOneBy({ id: campaignId, organizationId: org.id }) : null;
    if (campaignId && !campaign) throw new BadRequestException('Campanha não encontrada nesta organização.');
    const inferred = campaign?.id ?? expense?.campaignId ?? delivery?.campaignId ?? null;
    if ((expense && expense.campaignId !== inferred) || (delivery && delivery.campaignId !== inferred)) {
      throw new BadRequestException('Os vínculos escolhidos pertencem a campanhas diferentes.');
    }
    return { campaignId: inferred, expenseId: expense?.id ?? null, deliveryRecordId: delivery?.id ?? null };
  }

  async create(ongId: number, dto: CreatePublicacaoDto, image?: Express.Multer.File, ip?: string) {
    const ong = await this.activeOng(ongId);
    const access = await this.organizations.contentAccess(ongId);
    if (!access.canSubmit) throw new ForbiddenException('Confira o CNPJ da organização antes de enviar publicações.');
    const org = await this.orgs.findOneBy({ ownerId: ong.id });
    const links = await this.resolveLinks(org, dto);
    const file = image ? prepareAnexo(image) : null;
    if (file?.kind === 'IMAGEM' && !dto.imageConsent) {
      throw new BadRequestException('Confirme que você tem autorização de uso das imagens (e que não expõe crianças ou pessoas vulneráveis).');
    }
    if (file?.kind === 'DOCUMENTO') throw new BadRequestException('No campo de imagem envie JPG, PNG ou WebP; documentos entram como anexo da publicação.');

    const saved = await this.dataSource.transaction(async (m) => {
      const p = await m.save(Publicacao, m.create(Publicacao, { ongId: ong.id, organizationId: org?.id ?? null, description: dto.description, category: dto.category ?? 'ATUALIZACAO', imageUrl: null, reviewStatus: access.canPublishWithoutReview ? ContentReviewStatus.APROVADA : ContentReviewStatus.PENDENTE, reviewedBy: null, reviewedAt: access.canPublishWithoutReview ? new Date() : null, ...links }));
      await this.audit.log({ actor: { id: ong.id, type: UserType.ONG }, action: 'PUBLICATION_CREATED', entityType: 'publicacao', entityId: p.id, organizationId: org?.id ?? null, metadata: { category: p.category, reviewStatus: p.reviewStatus, ...links }, ip }, m);
      if (file) await this.saveAnexo(m, p, file, ong.id, !!dto.imageConsent, ip);
      return p;
    });
    return { id: saved.id, category: saved.category, reviewStatus: saved.reviewStatus, createdAt: saved.createdAt, ...links, message: saved.reviewStatus === ContentReviewStatus.PENDENTE ? 'Publicação enviada para análise; ela ficará visível após aprovação.' : 'Publicação disponível.', attachmentNote: file ? 'A imagem aparece publicamente depois da análise do arquivo.' : null };
  }

  private async saveAnexo(m: import('typeorm').EntityManager, p: Publicacao, f: ReturnType<typeof prepareAnexo>, userId: number, consent: boolean, ip?: string) {
    const a = await m.save(PublicacaoAnexo, m.create(PublicacaoAnexo, { ...f, publicacaoId: p.id, organizationId: p.organizationId, uploadedBy: userId, imageConsent: f.kind === 'IMAGEM' ? consent : false, status: AccStatus.ENVIADA }));
    await this.audit.log({ actor: { id: userId, type: UserType.ONG }, action: 'PUBLICATION_ATTACHMENT_ADDED', entityType: 'publicacao_anexo', entityId: a.id, organizationId: p.organizationId, metadata: { publicacaoId: p.id, kind: f.kind, sha256: f.sha256, imageConsent: a.imageConsent }, ip }, m);
    return a;
  }

  async addAttachment(ongId: number, publicacaoId: number, file: Express.Multer.File | undefined, consent: boolean, ip?: string) {
    await this.activeOng(ongId);
    const p = await this.repo.findOneBy({ id: publicacaoId, ongId });
    if (!p) throw new NotFoundException(NOT_FOUND);
    if ((await this.anexos.countBy({ publicacaoId })) >= MAX_ANEXOS_POR_PUBLICACAO) throw new BadRequestException(`Limite de ${MAX_ANEXOS_POR_PUBLICACAO} anexos por publicação.`);
    const f = prepareAnexo(file);
    if (f.kind === 'IMAGEM' && !consent) throw new BadRequestException('Confirme a autorização de uso das imagens.');
    const a = await this.dataSource.transaction((m) => this.saveAnexo(m, p, f, ongId, consent, ip));
    return { id: a.id, kind: a.kind, status: a.status, sha256: a.sha256 };
  }

  // ---------- Leitura pública ----------

  private publicQuery() {
    return this.repo.createQueryBuilder('p')
      .innerJoin(User, 'owner', 'owner.id = p."ongId" AND owner.status = :active AND owner."medalhaVerde" = true', { active: UserStatus.ATIVO })
      .leftJoinAndSelect('p.ong', 'ong')
      .where('p."reviewStatus" = :approved', { approved: ContentReviewStatus.APROVADA })
      .select(['p', 'ong.id', 'ong.name', 'ong.profileImage'])
      .orderBy('p.createdAt', 'DESC').addOrderBy('p.id', 'DESC');
  }

  /** Monta a visão pública: só anexos aprovados e publicáveis; o resto aparece como contagem. */
  private async publicView(items: Publicacao[]) {
    if (!items.length) return [];
    const ids = items.map((p) => p.id);
    const files = await this.anexos.find({ select: FILE_META, where: { publicacaoId: In(ids) }, order: { createdAt: 'ASC' } });
    const expenseIds = [...new Set(items.map((p) => p.expenseId).filter(Boolean))] as string[];
    const deliveryIds = [...new Set(items.map((p) => p.deliveryRecordId).filter(Boolean))] as string[];
    const campaignIds = [...new Set(items.map((p) => p.campaignId).filter(Boolean))] as string[];
    const [exp, evid, camps] = await Promise.all([
      expenseIds.length ? this.expenses.find({ select: { id: true, status: true }, where: { id: In(expenseIds) } }) : Promise.resolve([] as Expense[]),
      deliveryIds.length ? this.evidences.find({ select: { id: true, deliveryRecordId: true }, where: { deliveryRecordId: In(deliveryIds), status: AccStatus.APROVADA } }) : Promise.resolve([] as DeliveryEvidence[]),
      campaignIds.length ? this.campaigns.find({ select: { id: true, title: true }, where: { id: In(campaignIds) } }) : Promise.resolve([] as Campaign[]),
    ]);
    const expenseOk = new Set(exp.filter((e) => e.status === AccStatus.APROVADA).map((e) => e.id));
    const deliveryOk = new Set(evid.map((e) => e.deliveryRecordId));
    const title = new Map<string, string>(camps.map((c) => [c.id, c.title] as [string, string]));

    return items.map((p) => {
      const mine = files.filter((f) => f.publicacaoId === p.id);
      const shown = mine.filter((f) => f.status === AccStatus.APROVADA && f.publishable);
      const linkedProof = (p.expenseId && expenseOk.has(p.expenseId)) || (p.deliveryRecordId && deliveryOk.has(p.deliveryRecordId));
      const classification: Classification = shown.length || linkedProof ? 'EVIDENCIAS_ANALISADAS' : mine.length ? 'DOCUMENTADA' : 'INSTITUCIONAL';
      const url = (f: { id: string }) => `/publicacoes/anexos/${f.id}/file`;
      const images = shown.filter((f) => f.kind === 'IMAGEM').map((f) => ({ id: f.id, url: url(f) }));
      return {
        id: p.id, ongId: p.ongId, organizationId: p.organizationId, description: p.description, createdAt: p.createdAt, ong: p.ong,
        category: p.category, categoryLabel: CATEGORY_LABEL[p.category as Category] ?? p.category,
        // Compatível com o front antigo: imagem legada (disco) ou a primeira imagem aprovada.
        imageUrl: p.imageUrl ?? images[0]?.url ?? null,
        images,
        documents: shown.filter((f) => f.kind === 'DOCUMENTO').map((f) => ({ id: f.id, url: url(f), mime: f.mime, sha256: f.sha256 })),
        evidenceStatus: { published: shown.length, awaitingAnalysis: mine.filter((f) => f.status === AccStatus.ENVIADA || f.status === AccStatus.EM_ANALISE).length },
        classification,
        campaign: p.campaignId ? { id: p.campaignId, title: title.get(p.campaignId) ?? null } : null,
        // Só expõe o vínculo quando há registro público por trás (despesa aprovada / entrega com evidência aprovada).
        accountability: { available: !!linkedProof || !!p.campaignId, expenseId: p.expenseId && expenseOk.has(p.expenseId) ? p.expenseId : null, deliveryRecordId: p.deliveryRecordId && deliveryOk.has(p.deliveryRecordId) ? p.deliveryRecordId : null },
      };
    });
  }

  private async page(qb: ReturnType<PublicacoesService['publicQuery']>, { page, limit }: PublicacoesQueryDto) {
    const [rows, total] = await qb.skip((page - 1) * limit).take(limit).getManyAndCount();
    return { items: await this.publicView(rows), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private byCategory(qb: ReturnType<PublicacoesService['publicQuery']>, category?: string) {
    return category ? qb.andWhere('p.category = :category', { category }) : qb;
  }

  findAll(query: PublicacoesQueryDto) {
    return this.page(this.byCategory(this.publicQuery(), query.category), query);
  }

  async findByOng(ongId: number, query: PublicacoesQueryDto) {
    const ong = await this.usersRepository.findOne({ where: { id: ongId, type: UserType.ONG }, select: ['id'] });
    if (!ong) throw new NotFoundException('ONG não encontrada');
    return this.page(this.byCategory(this.publicQuery().andWhere('p."ongId" = :ongId', { ongId }), query.category), query);
  }

  async findOne(id: number) {
    const p = await this.publicQuery().andWhere('p.id = :id', { id }).getOne();
    if (!p) throw new NotFoundException(NOT_FOUND);
    return (await this.publicView([p]))[0];
  }

  /** Arquivo público: só aprovado + publicável + organização ainda aprovada. */
  async publicFile(id: string) {
    const a = await this.anexos.findOne({ where: { id, status: AccStatus.APROVADA, publishable: true }, select: { ...FILE_META, content: true } });
    const p = a && (await this.publicQuery().andWhere('p.id = :pid', { pid: a.publicacaoId }).getOne());
    if (!a || !p) throw new NotFoundException('Arquivo não encontrado.');
    return a;
  }

  // ---------- Área da ONG ----------

  async mine(ongId: number) {
    const rows = await this.repo.find({ where: { ongId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 100 });
    const files = rows.length ? await this.anexos.find({ select: FILE_META, where: { publicacaoId: In(rows.map((r) => r.id)) } }) : [];
    return rows.map((p) => ({ ...p, categoryLabel: CATEGORY_LABEL[p.category as Category] ?? p.category, anexos: files.filter((f) => f.publicacaoId === p.id) }));
  }

  async ownFile(ongId: number, id: string) {
    const a = await this.anexos.findOne({ where: { id }, select: { ...FILE_META, content: true, uploadedBy: true } });
    if (!a || !(await this.repo.existsBy({ id: a.publicacaoId, ongId }))) throw new NotFoundException('Arquivo não encontrado.');
    return a;
  }

  // ---------- Análise (admin) ----------

  listPendingFiles() {
    return this.anexos.find({ select: FILE_META, where: { status: In([AccStatus.ENVIADA, AccStatus.EM_ANALISE]) }, order: { createdAt: 'ASC' }, take: 200 });
  }

  listPendingPublications() {
    return this.repo.find({
      where: { reviewStatus: ContentReviewStatus.PENDENTE },
      relations: { ong: true },
      select: { id: true, ongId: true, description: true, category: true, createdAt: true, reviewStatus: true, ong: { id: true, name: true } },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async reviewPublication(admin: RequestUser, id: number, decision: ContentReviewDecision, reason?: string, ip?: string) {
    validateContentDecision(decision, reason);
    const publication = await this.repo.findOneBy({ id });
    if (!publication) throw new NotFoundException(NOT_FOUND);
    if (publication.reviewStatus !== ContentReviewStatus.PENDENTE) throw new BadRequestException('A publicação já foi analisada.');
    publication.reviewStatus = decision === 'APROVAR' ? ContentReviewStatus.APROVADA : ContentReviewStatus.REPROVADA;
    publication.reviewReason = decision === 'REPROVAR' ? reason!.trim() : null;
    publication.reviewedBy = admin.id;
    publication.reviewedAt = new Date();
    await this.repo.save(publication);
    await this.audit.log({ actor: admin, action: 'PUBLICATION_REVIEWED', entityType: 'publicacao', entityId: String(id), organizationId: publication.organizationId, metadata: { decision, reason: publication.reviewReason }, ip });
    return { id, reviewStatus: publication.reviewStatus, reviewReason: publication.reviewReason };
  }

  async adminFile(id: string) {
    const a = await this.anexos.findOne({ where: { id }, select: { ...FILE_META, content: true } });
    if (!a) throw new NotFoundException('Arquivo não encontrado.');
    return a;
  }

  async reviewFile(admin: RequestUser, id: string, dto: ReviewActionDto, ip?: string) {
    const a = await this.anexos.findOne({ where: { id }, select: FILE_META });
    if (!a) throw new NotFoundException('Arquivo não encontrado.');
    if (needsReason(dto.action) && !dto.reason) throw new BadRequestException('Informe o motivo.');
    const status = nextStatus(a.status, dto.action);
    // Imagem só pode ser publicada com a autorização de imagem declarada pela ONG.
    const publishable = dto.action === 'APROVAR' && !!dto.publishable && (a.kind !== 'IMAGEM' || a.imageConsent);
    if (dto.action === 'APROVAR' && dto.publishable && !publishable) throw new BadRequestException('A ONG não declarou autorização de uso da imagem: não é possível publicá-la.');
    await this.dataSource.transaction(async (m) => {
      await m.update(PublicacaoAnexo, id, { status, reviewedBy: admin.id, reviewedAt: new Date(), reviewReason: dto.reason ?? null, publishable });
      await this.audit.log({ actor: admin, action: 'PUBLICATION_ATTACHMENT_REVIEWED', entityType: 'publicacao_anexo', entityId: id, organizationId: a.organizationId, metadata: { status, publishable, reason: dto.reason ?? null }, ip }, m);
    });
    return { id, status, publishable };
  }
}
