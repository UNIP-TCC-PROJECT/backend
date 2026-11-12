import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { detectImage } from '../common/file-upload';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-context';
import { DonationStatus } from '../donations/entities/donation.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { User } from '../users/entities/user.entity';
import type { CampaignStatusDto, CreateCampaignDto, UpdateCampaignDto } from './campaigns.dto';
import { Campaign, CampaignStatus } from './entities/campaign.entity';
import { ContentReviewStatus, validateContentDecision, type ContentReviewDecision } from '../common/content-moderation';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign) private repo: Repository<Campaign>,
    private orgs: OrganizationsService,
    private audit: AuditService,
  ) {}

  /** Campanha da ONG do usuário; de outra ONG responde 404 (não revela existência). */
  async ownedBy(userId: number, id: string): Promise<Campaign> {
    const org = await this.orgs.ofOwner(userId);
    const c = await this.repo.findOneBy({ id, organizationId: org.id });
    if (!c) throw new NotFoundException('Campanha não encontrada.');
    return c;
  }

  async create(user: RequestUser, dto: CreateCampaignDto, ip?: string) {
    const access = await this.orgs.contentAccess(user.id, true);
    if (!access.canSubmit) throw new ForbiddenException('Confira o CNPJ da organização antes de cadastrar campanhas.');
    const org = await this.orgs.ofOwner(user.id);
    this.assertDates(dto.startsAt, dto.endsAt);
    const c = await this.repo.save(this.repo.create({ ...dto, startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, organizationId: org.id, reviewStatus: access.canPublishWithoutReview ? ContentReviewStatus.APROVADA : ContentReviewStatus.PENDENTE, reviewedAt: access.canPublishWithoutReview ? new Date() : null }));
    await this.audit.log({ actor: user, action: 'CAMPAIGN_CREATED', entityType: 'campaign', entityId: c.id, organizationId: org.id, ip });
    return c;
  }

  async update(user: RequestUser, id: string, dto: UpdateCampaignDto, ip?: string) {
    const access = await this.orgs.contentAccess(user.id, true);
    if (!access.canSubmit) throw new ForbiddenException('Confira o CNPJ da organização antes de editar campanhas.');
    const c = await this.ownedBy(user.id, id);
    if ([CampaignStatus.ENCERRADA, CampaignStatus.SUSPENSA].includes(c.status)) {
      throw new BadRequestException('Campanha encerrada ou suspensa não pode ser editada.');
    }
    const fields = Object.keys(dto);
    this.assertDates(dto.startsAt ?? c.startsAt?.toISOString(), dto.endsAt ?? c.endsAt?.toISOString());
    Object.assign(c, dto, dto.startsAt ? { startsAt: new Date(dto.startsAt) } : {}, dto.endsAt ? { endsAt: new Date(dto.endsAt) } : {});
    if (!access.canPublishWithoutReview) {
      c.reviewStatus = ContentReviewStatus.PENDENTE;
      c.reviewedAt = null;
      c.reviewedBy = null;
      c.reviewReason = null;
      if (c.status === CampaignStatus.ATIVA) c.status = CampaignStatus.RASCUNHO;
    }
    await this.repo.save(c);
    await this.audit.log({ actor: user, action: 'CAMPAIGN_UPDATED', entityType: 'campaign', entityId: id, organizationId: c.organizationId, metadata: { fields }, ip });
    return c;
  }

  async setStatus(user: RequestUser, id: string, dto: CampaignStatusDto, ip?: string) {
    const access = await this.orgs.contentAccess(user.id, true);
    if (!access.canSubmit) throw new ForbiddenException('Confira o CNPJ da organização antes de alterar campanhas.');
    const c = await this.ownedBy(user.id, id);
    if (dto.status === 'ATIVA' && c.reviewStatus !== ContentReviewStatus.APROVADA)
      throw new ForbiddenException('A campanha precisa ser aprovada pela plataforma antes de ser publicada.');
    const allowed = dto.status === 'ATIVA' ? c.status === CampaignStatus.RASCUNHO : c.status === CampaignStatus.ATIVA;
    if (!allowed) throw new BadRequestException(`Transição ${c.status} → ${dto.status} não permitida.`);
    if (dto.status === 'ATIVA') {
      if (!c.startsAt || !c.endsAt) throw new BadRequestException('Defina as datas de início e encerramento antes de publicar.');
      if (c.endsAt <= new Date()) throw new BadRequestException('A data de encerramento já passou.');
    }
    c.status = dto.status as CampaignStatus;
    await this.repo.save(c);
    await this.audit.log({ actor: user, action: dto.status === 'ATIVA' ? 'CAMPAIGN_PUBLISHED' : 'CAMPAIGN_CLOSED', entityType: 'campaign', entityId: id, organizationId: c.organizationId, ip });
    return c;
  }

  private assertDates(start?: string | null, end?: string | null) {
    if (start && end && new Date(end) <= new Date(start)) throw new BadRequestException('O encerramento deve ser posterior ao início.');
  }

  /** Grava a imagem de apresentação (JPG/PNG, validada pelos bytes) na pasta pública de uploads. */
  async setImage(user: RequestUser, id: string, file: Express.Multer.File | undefined, ip?: string) {
    const access = await this.orgs.contentAccess(user.id, true);
    if (!access.canSubmit) throw new ForbiddenException('Confira o CNPJ da organização antes de alterar campanhas.');
    const c = await this.ownedBy(user.id, id);
    const kind = detectImage(file?.buffer);
    if (!file || !kind || kind.ext === 'webp' || file.size > 3 * 1024 * 1024) throw new BadRequestException('Envie uma imagem JPG ou PNG de até 3 MB.');
    const name = `${randomUUID()}.${kind.ext}`;
    await mkdir(join(process.cwd(), 'uploads', 'campaigns'), { recursive: true });
    await writeFile(join(process.cwd(), 'uploads', 'campaigns', name), file.buffer);
    c.imageUrl = `/uploads/campaigns/${name}`;
    if (!access.canPublishWithoutReview) {
      c.reviewStatus = ContentReviewStatus.PENDENTE;
      c.reviewedAt = null;
      c.reviewedBy = null;
      c.reviewReason = null;
      if (c.status === CampaignStatus.ATIVA) c.status = CampaignStatus.RASCUNHO;
    }
    await this.repo.save(c);
    await this.audit.log({ actor: user, action: 'CAMPAIGN_UPDATED', entityType: 'campaign', entityId: id, organizationId: c.organizationId, metadata: { fields: ['imageUrl'] }, ip });
    return { imageUrl: c.imageUrl };
  }

  async listMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    return this.repo.find({ where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
  }

  async getMine(userId: number, id: string) {
    return this.ownedBy(userId, id);
  }

  /** Vitrine pública: campanhas ativas, analisadas e vinculadas a uma ONG ativa com CNPJ conferido. */
  async listPublic() {
    const rows = await this.repo
      .createQueryBuilder('c')
      .innerJoin('c.organization', 'o')
      .innerJoin(User, 'owner', 'owner.id = o."ownerId" AND owner.status = :userActive AND owner."medalhaVerde" = true', { userActive: 'ATIVO' })
      .leftJoin('donations', 'd', 'd.campaignId = c.id AND d.status = :conf', { conf: DonationStatus.CONFIRMADA })
      .where('c.status = :active', { active: CampaignStatus.ATIVA })
      .andWhere('c."reviewStatus" = :reviewApproved', { reviewApproved: ContentReviewStatus.APROVADA })
      .andWhere('(c."endsAt" IS NULL OR c."endsAt" > now()) AND (c."startsAt" IS NULL OR c."startsAt" <= now())')
      .select(['c.id AS id', 'c.title AS title', 'c.description AS description', 'c.objective AS objective', 'c."imageUrl" AS "imageUrl"', 'c."goalCents" AS "goalCents"', 'c."startsAt" AS "startsAt"', 'c."endsAt" AS "endsAt"', 'o.id AS "organizationId"', 'COALESCE(o."tradeName", o."legalName") AS "organizationName"'])
      .addSelect('COALESCE(SUM(d."amountCents"), 0)', 'raisedCents')
      .addSelect('COUNT(d.id)', 'donationsCount')
      .groupBy('c.id').addGroupBy('o.id')
      .orderBy('c."createdAt"', 'DESC')
      .getRawMany();
    return rows.map((r) => ({ ...r, goalCents: Number(r.goalCents), raisedCents: Number(r.raisedCents), donationsCount: Number(r.donationsCount) }));
  }

  async getPublic(id: string) {
    const c = (await this.listPublic()).find((x) => x.id === id);
    if (!c) throw new NotFoundException('Campanha não encontrada.');
    return c;
  }

  // ---------- Administração ----------

  listAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  listPendingReview() {
    return this.repo.find({ where: { reviewStatus: ContentReviewStatus.PENDENTE }, relations: { organization: true }, order: { createdAt: 'ASC' }, take: 200 });
  }

  async review(admin: RequestUser, id: string, decision: ContentReviewDecision, reason?: string, ip?: string) {
    validateContentDecision(decision, reason);
    const campaign = await this.repo.findOneBy({ id });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (campaign.reviewStatus !== ContentReviewStatus.PENDENTE) throw new BadRequestException('A campanha já foi analisada.');
    campaign.reviewStatus = decision === 'APROVAR' ? ContentReviewStatus.APROVADA : ContentReviewStatus.REPROVADA;
    campaign.reviewReason = decision === 'REPROVAR' ? reason!.trim() : null;
    campaign.reviewedBy = admin.id;
    campaign.reviewedAt = new Date();
    await this.repo.save(campaign);
    await this.audit.log({ actor: admin, action: 'CAMPAIGN_REVIEWED', entityType: 'campaign', entityId: id, organizationId: campaign.organizationId, metadata: { decision, reason: campaign.reviewReason }, ip });
    return { id, reviewStatus: campaign.reviewStatus, reviewReason: campaign.reviewReason };
  }

  async suspend(admin: RequestUser, id: string, reason: string, ip?: string) {
    const c = await this.repo.findOneBy({ id });
    if (!c) throw new NotFoundException('Campanha não encontrada.');
    if (c.status === CampaignStatus.SUSPENSA) throw new BadRequestException('Campanha já suspensa.');
    c.status = CampaignStatus.SUSPENSA;
    c.statusReason = reason;
    await this.repo.save(c);
    await this.audit.log({ actor: admin, action: 'CAMPAIGN_SUSPENDED', entityType: 'campaign', entityId: id, organizationId: c.organizationId, metadata: { reason }, ip });
    return c;
  }
}
