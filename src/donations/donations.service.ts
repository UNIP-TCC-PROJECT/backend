import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Campaign, CampaignStatus } from '../campaigns/entities/campaign.entity';
import type { RequestUser } from '../common/request-context';
import { Organization, OrganizationStatus } from '../organizations/entities/organization.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { Donation, DonationStatus } from './entities/donation.entity';

@Injectable()
export class DonationsService {
  constructor(
    @InjectRepository(Donation) private repo: Repository<Donation>,
    @InjectRepository(Campaign) private campaigns: Repository<Campaign>,
    @InjectDataSource() private dataSource: DataSource,
    private orgs: OrganizationsService,
    private audit: AuditService,
  ) {}

  /** Registra a intenção de doar. A confirmação virá do gateway (etapa de pagamentos). */
  async create(donor: RequestUser, campaignId: string, amountCents: number, ip?: string) {
    const c = await this.campaigns.findOne({ where: { id: campaignId }, relations: { organization: true } });
    if (!c || c.status !== CampaignStatus.ATIVA || c.organization.status !== OrganizationStatus.APROVADA) {
      throw new NotFoundException('Campanha não encontrada ou indisponível para doações.');
    }
    const d = await this.repo.save(this.repo.create({ campaignId, donorId: donor.id, amountCents }));
    await this.audit.log({ actor: donor, action: 'DONATION_CREATED', entityType: 'donation', entityId: d.id, organizationId: c.organizationId, metadata: { amountCents, campaignId }, ip });
    return d;
  }

  listMine(donorId: number) {
    return this.repo.find({ where: { donorId }, order: { createdAt: 'DESC' } });
  }

  /** Doações das campanhas da própria ONG; sem expor dados pessoais do doador. */
  async listForOrganization(userId: number) {
    const org = await this.orgs.ofOwner(userId);
    return this.repo
      .createQueryBuilder('d')
      .innerJoin('d.campaign', 'c', 'c.organizationId = :org', { org: org.id })
      .select(['d.id', 'd.campaignId', 'd.amountCents', 'd.status', 'd.confirmedAt', 'd.createdAt'])
      .orderBy('d.createdAt', 'DESC')
      .getMany();
  }

  /** Transição manual (admin) até o webhook do gateway assumir esta função. */
  async setStatus(admin: RequestUser, id: string, status: DonationStatus.CONFIRMADA | DonationStatus.CANCELADA, ip?: string) {
    return this.dataSource.transaction(async (m) => {
      const d = await m.findOne(Donation, { where: { id }, relations: { campaign: true }, lock: { mode: 'pessimistic_write', tables: ['donations'] } });
      if (!d) throw new NotFoundException('Doação não encontrada.');
      if (d.status !== DonationStatus.PENDENTE) throw new BadRequestException('Doação já finalizada.');
      await m.update(Donation, id, { status, confirmedAt: status === DonationStatus.CONFIRMADA ? new Date() : null });
      await this.audit.log({ actor: admin, action: status === DonationStatus.CONFIRMADA ? 'DONATION_CONFIRMED' : 'DONATION_CANCELLED', entityType: 'donation', entityId: id, organizationId: d.campaign.organizationId, metadata: { amountCents: d.amountCents }, ip }, m);
      return { id, status };
    });
  }
}
