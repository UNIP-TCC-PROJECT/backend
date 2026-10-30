import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-context';
import { DonationStatus } from '../donations/entities/donation.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrganizationStatus } from '../organizations/entities/organization.entity';
import type { CampaignStatusDto, CreateCampaignDto, UpdateCampaignDto } from './campaigns.dto';
import { Campaign, CampaignStatus } from './entities/campaign.entity';

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
    const org = await this.orgs.approvedOfOwner(user.id);
    const c = await this.repo.save(this.repo.create({ ...dto, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, organizationId: org.id }));
    await this.audit.log({ actor: user, action: 'CAMPAIGN_CREATED', entityType: 'campaign', entityId: c.id, organizationId: org.id, ip });
    return c;
  }

  async update(user: RequestUser, id: string, dto: UpdateCampaignDto, ip?: string) {
    await this.orgs.approvedOfOwner(user.id);
    const c = await this.ownedBy(user.id, id);
    if ([CampaignStatus.ENCERRADA, CampaignStatus.SUSPENSA].includes(c.status)) {
      throw new BadRequestException('Campanha encerrada ou suspensa não pode ser editada.');
    }
    const fields = Object.keys(dto);
    Object.assign(c, dto, dto.endsAt ? { endsAt: new Date(dto.endsAt) } : {});
    await this.repo.save(c);
    await this.audit.log({ actor: user, action: 'CAMPAIGN_UPDATED', entityType: 'campaign', entityId: id, organizationId: c.organizationId, metadata: { fields }, ip });
    return c;
  }

  async setStatus(user: RequestUser, id: string, dto: CampaignStatusDto, ip?: string) {
    await this.orgs.approvedOfOwner(user.id);
    const c = await this.ownedBy(user.id, id);
    const allowed = dto.status === 'ATIVA' ? c.status === CampaignStatus.RASCUNHO : c.status === CampaignStatus.ATIVA;
    if (!allowed) throw new BadRequestException(`Transição ${c.status} → ${dto.status} não permitida.`);
    c.status = dto.status as CampaignStatus;
    await this.repo.save(c);
    await this.audit.log({ actor: user, action: dto.status === 'ATIVA' ? 'CAMPAIGN_PUBLISHED' : 'CAMPAIGN_CLOSED', entityType: 'campaign', entityId: id, organizationId: c.organizationId, ip });
    return c;
  }

  async listMine(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    return this.repo.find({ where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
  }

  async getMine(userId: number, id: string) {
    return this.ownedBy(userId, id);
  }

  /** Vitrine pública: só campanhas ATIVAS de ONGs APROVADAS, sem dados internos. */
  async listPublic() {
    const rows = await this.repo
      .createQueryBuilder('c')
      .innerJoin('c.organization', 'o', 'o.status = :ok', { ok: OrganizationStatus.APROVADA })
      .leftJoin('donations', 'd', 'd.campaignId = c.id AND d.status = :conf', { conf: DonationStatus.CONFIRMADA })
      .where('c.status = :active', { active: CampaignStatus.ATIVA })
      .select(['c.id AS id', 'c.title AS title', 'c.description AS description', 'c."goalCents" AS "goalCents"', 'c."endsAt" AS "endsAt"', 'o.id AS "organizationId"', 'COALESCE(o."tradeName", o."legalName") AS "organizationName"'])
      .addSelect('COALESCE(SUM(d."amountCents"), 0)', 'raisedCents')
      .groupBy('c.id').addGroupBy('o.id')
      .orderBy('c."createdAt"', 'DESC')
      .getRawMany();
    return rows.map((r) => ({ ...r, goalCents: Number(r.goalCents), raisedCents: Number(r.raisedCents) }));
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
