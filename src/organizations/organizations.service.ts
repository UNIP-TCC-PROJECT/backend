import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Campaign, CampaignStatus } from '../campaigns/entities/campaign.entity';
import { prepareFile } from '../common/file-upload';
import type { RequestUser } from '../common/request-context';
import { ReviewStatus } from '../common/stored-file.base';
import { User, UserType } from '../users/entities/user.entity';
import { OrganizationDocument } from './entities/organization-document.entity';
import { OrganizationValidation } from './entities/organization-validation.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import type { ReviewDto, UpdateOrganizationDto, UploadDocumentDto } from './organizations.dto';

const DOC_COLUMNS = {
  id: true, organizationId: true, type: true, name: true, mime: true, size: true, sha256: true,
  status: true, reviewReason: true, reviewedAt: true, supersededAt: true, createdAt: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization) private orgs: Repository<Organization>,
    @InjectRepository(OrganizationDocument) private docs: Repository<OrganizationDocument>,
    @InjectRepository(OrganizationValidation) private validations: Repository<OrganizationValidation>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private dataSource: DataSource,
    private audit: AuditService,
  ) {}

  /**
   * Única porta de entrada para resolver "a ONG do usuário logado". A organização nunca vem de
   * parâmetro/corpo da requisição, o que impede acesso a dados de outra ONG.
   * ONGs criadas antes desta etapa ganham o registro de organização no primeiro acesso.
   */
  async ofOwner(userId: number, ip?: string): Promise<Organization> {
    const found = await this.orgs.findOneBy({ ownerId: userId });
    if (found) return found;

    const user = await this.users.findOneBy({ id: userId });
    if (!user || user.type !== UserType.ONG) throw new ForbiddenException('Apenas ONGs possuem organização.');
    const cnpj = user.cnpj?.replace(/\D/g, '');
    if (!cnpj || cnpj.length !== 14) throw new BadRequestException('CNPJ da ONG ausente ou inválido.');
    if (await this.orgs.existsBy({ cnpj })) throw new ConflictException('CNPJ já vinculado a outra organização.');

    const org = await this.orgs.save(
      this.orgs.create({ ownerId: userId, cnpj, legalName: user.legalName ?? user.name, tradeName: user.name, description: user.description ?? null }),
    );
    await this.audit.log({ actor: { id: userId, type: user.type }, action: 'ORG_CREATED', entityType: 'organization', entityId: org.id, organizationId: org.id, ip });
    return org;
  }

  /** Para operações que alteram dados: ONG precisa estar APROVADA (não suspensa/reprovada). */
  async approvedOfOwner(userId: number): Promise<Organization> {
    const org = await this.ofOwner(userId);
    if (org.status !== OrganizationStatus.APROVADA) {
      throw new ForbiddenException('A organização precisa estar aprovada para esta ação.');
    }
    return org;
  }

  async updateMine(user: RequestUser, dto: UpdateOrganizationDto, ip?: string) {
    const org = await this.ofOwner(user.id, ip);
    if (org.status === OrganizationStatus.SUSPENSA) throw new ForbiddenException('Organização suspensa.');
    const changed = (Object.keys(dto) as (keyof UpdateOrganizationDto)[]).filter((k) => dto[k] !== undefined && dto[k] !== org[k]);
    Object.assign(org, dto);
    await this.orgs.save(org);
    await this.audit.log({ actor: user, action: 'ORG_UPDATED', entityType: 'organization', entityId: org.id, organizationId: org.id, metadata: { fields: changed }, ip });
    return org;
  }

  async submit(user: RequestUser, ip?: string) {
    const org = await this.ofOwner(user.id, ip);
    if (![OrganizationStatus.RASCUNHO, OrganizationStatus.REPROVADA].includes(org.status)) {
      throw new BadRequestException('A organização não pode ser enviada para análise neste estado.');
    }
    const docs = await this.docs.countBy({ organizationId: org.id, supersededAt: IsNull() });
    if (!docs) throw new BadRequestException('Envie ao menos um documento antes de solicitar a análise.');
    org.status = OrganizationStatus.EM_ANALISE;
    org.statusReason = null;
    await this.orgs.save(org);
    await this.audit.log({ actor: user, action: 'ORG_SUBMITTED', entityType: 'organization', entityId: org.id, organizationId: org.id, ip });
    return org;
  }

  async uploadDocument(user: RequestUser, dto: UploadDocumentDto, file: Express.Multer.File | undefined, ip?: string) {
    const org = await this.ofOwner(user.id, ip);
    if (org.status === OrganizationStatus.SUSPENSA) throw new ForbiddenException('Organização suspensa.');
    const data = prepareFile(file);

    return this.dataSource.transaction(async (m) => {
      const previous = await m.findOne(OrganizationDocument, { where: { organizationId: org.id, type: dto.type, supersededAt: IsNull() } });
      if (previous) await m.update(OrganizationDocument, previous.id, { supersededAt: new Date() });
      const doc = await m.save(OrganizationDocument, m.create(OrganizationDocument, { ...data, organizationId: org.id, type: dto.type, uploadedBy: user.id, supersededAt: null }));
      await this.audit.log(
        { actor: user, action: previous ? 'ORG_DOCUMENT_REPLACED' : 'ORG_DOCUMENT_UPLOADED', entityType: 'organization_document', entityId: doc.id, organizationId: org.id, metadata: { type: dto.type, sha256: data.sha256, replaced: previous?.id ?? null }, ip },
        m,
      );
      const { content, ...meta } = doc;
      return meta;
    });
  }

  async listDocumentsMine(userId: number) {
    const org = await this.ofOwner(userId);
    return this.docs.find({ select: DOC_COLUMNS, where: { organizationId: org.id }, order: { createdAt: 'DESC' } });
  }

  async getDocumentFile(user: RequestUser, id: string) {
    const doc = await this.docs.findOne({ where: { id }, select: { ...DOC_COLUMNS, content: true } });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    if (user.type !== UserType.ADMIN) {
      const org = await this.ofOwner(user.id);
      if (doc.organizationId !== org.id) throw new NotFoundException('Documento não encontrado.');
    }
    return doc;
  }

  // ---------- Administração ----------

  listAll(status?: OrganizationStatus) {
    return this.orgs.find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } });
  }

  async getForAdmin(id: string) {
    const org = await this.orgs.findOneBy({ id });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    const [documents, history] = await Promise.all([
      this.docs.find({ select: DOC_COLUMNS, where: { organizationId: id }, order: { createdAt: 'DESC' } }),
      this.validations.find({ where: { organizationId: id }, order: { createdAt: 'DESC' } }),
    ]);
    return { ...org, documents, validations: history };
  }

  async decide(admin: RequestUser, id: string, dto: ReviewDto, ip?: string) {
    const org = await this.orgs.findOneBy({ id });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    if (org.status !== OrganizationStatus.EM_ANALISE) throw new BadRequestException('A organização não está em análise.');
    const approve = dto.decision === 'APROVAR';
    if (approve) {
      const pending = await this.docs.countBy({ organizationId: id, supersededAt: IsNull(), status: ReviewStatus.PENDENTE });
      const approved = await this.docs.countBy({ organizationId: id, supersededAt: IsNull(), status: ReviewStatus.APROVADO });
      if (pending || !approved) throw new BadRequestException('Analise todos os documentos vigentes (ao menos um aprovado) antes de aprovar.');
    }
    await this.dataSource.transaction(async (m) => {
      await m.update(Organization, id, {
        status: approve ? OrganizationStatus.APROVADA : OrganizationStatus.REPROVADA,
        statusReason: approve ? null : dto.reason,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      });
      await m.insert(OrganizationValidation, { organizationId: id, decision: dto.decision, reason: dto.reason ?? null, reviewedBy: admin.id });
      await this.audit.log({ actor: admin, action: approve ? 'ORG_APPROVED' : 'ORG_REJECTED', entityType: 'organization', entityId: id, organizationId: id, metadata: { reason: dto.reason ?? null }, ip }, m);
    });
    return this.orgs.findOneByOrFail({ id });
  }

  async reviewDocument(admin: RequestUser, docId: string, dto: ReviewDto, ip?: string) {
    const doc = await this.docs.findOne({ where: { id: docId }, select: DOC_COLUMNS });
    if (!doc || doc.supersededAt) throw new NotFoundException('Documento não encontrado.');
    const status = dto.decision === 'APROVAR' ? ReviewStatus.APROVADO : ReviewStatus.REPROVADO;
    await this.dataSource.transaction(async (m) => {
      await m.update(OrganizationDocument, docId, { status, reviewedBy: admin.id, reviewedAt: new Date(), reviewReason: dto.reason ?? null });
      await this.audit.log({ actor: admin, action: 'ORG_DOCUMENT_REVIEWED', entityType: 'organization_document', entityId: docId, organizationId: doc.organizationId, metadata: { status, reason: dto.reason ?? null }, ip }, m);
    });
    return { id: docId, status };
  }

  /** Suspende a ONG e, na mesma transação, suspende suas campanhas ativas. */
  async suspend(admin: RequestUser, id: string, reason: string, ip?: string) {
    const org = await this.orgs.findOneBy({ id });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    if (org.status === OrganizationStatus.SUSPENSA) throw new BadRequestException('Organização já suspensa.');
    await this.dataSource.transaction(async (m) => {
      await m.update(Organization, id, { status: OrganizationStatus.SUSPENSA, statusReason: reason, reviewedBy: admin.id, reviewedAt: new Date() });
      await m.update(Campaign, { organizationId: id, status: CampaignStatus.ATIVA }, { status: CampaignStatus.SUSPENSA, statusReason: 'Organização suspensa' });
      await m.insert(OrganizationValidation, { organizationId: id, decision: 'SUSPENDER', reason, reviewedBy: admin.id });
      await this.audit.log({ actor: admin, action: 'ORG_SUSPENDED', entityType: 'organization', entityId: id, organizationId: id, metadata: { reason }, ip }, m);
    });
    return this.orgs.findOneByOrFail({ id });
  }
}
