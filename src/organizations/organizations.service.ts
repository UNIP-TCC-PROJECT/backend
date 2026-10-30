import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Campaign, CampaignStatus } from '../campaigns/entities/campaign.entity';
import { prepareFile } from '../common/file-upload';
import type { RequestUser } from '../common/request-context';
import { ReviewStatus } from '../common/stored-file.base';
import { User, UserType } from '../users/entities/user.entity';
import { ExternalChecksService } from './external-checks.service';
import { isValidCnpj, onlyDigits } from './cnpj.util';
import { CheckSource, CheckStatus } from './entities/organization-external-check.entity';
import { OrganizationDocument, REQUIRED_DOCUMENT_TYPES } from './entities/organization-document.entity';
import { OrganizationValidation } from './entities/organization-validation.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import type { RequestDocumentsDto, ReviewDto, UpdateOrganizationDto, UploadDocumentDto } from './organizations.dto';

const DOC_COLUMNS = {
  id: true, organizationId: true, type: true, name: true, mime: true, size: true, sha256: true,
  status: true, reviewReason: true, reviewedAt: true, supersededAt: true, createdAt: true,
} as const;

@Injectable()
export class OrganizationsService implements OnModuleInit {
  constructor(
    @InjectRepository(Organization) private orgs: Repository<Organization>,
    @InjectRepository(OrganizationDocument) private docs: Repository<OrganizationDocument>,
    @InjectRepository(OrganizationValidation) private validations: Repository<OrganizationValidation>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private dataSource: DataSource,
    private audit: AuditService,
    private checks: ExternalChecksService,
  ) {}

  // Estado renomeado na etapa de validação institucional (RASCUNHO → INCOMPLETO).
  async onModuleInit() {
    await this.orgs.update({ status: 'RASCUNHO' as OrganizationStatus }, { status: OrganizationStatus.INCOMPLETO });
  }

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
    const cnpj = onlyDigits(user.cnpj);
    if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ da ONG ausente ou inválido.');
    if (await this.orgs.existsBy({ cnpj })) throw new ConflictException('CNPJ já vinculado a outra organização.');

    const org = await this.orgs.save(
      this.orgs.create({ ownerId: userId, cnpj, legalName: user.legalName ?? user.name, tradeName: user.name, description: user.description ?? null, email: user.email, phone: onlyDigits(user.phone) || null, zip: onlyDigits(user.zip) || null, street: user.street ?? null, city: user.city ?? null, state: user.state?.slice(0, 2).toUpperCase() ?? null }),
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

  /** O que falta para solicitar a análise (campos e documentos obrigatórios vigentes). */
  async missingForSubmission(org: Organization) {
    const labels: Partial<Record<keyof Organization, string>> = {
      legalName: 'Razão social', email: 'E-mail institucional', phone: 'Telefone', zip: 'CEP', street: 'Logradouro', number: 'Número',
      district: 'Bairro', city: 'Cidade', state: 'UF', description: 'Descrição das atividades', legalRepName: 'Nome do representante legal',
      legalRepCpf: 'CPF do representante legal', legalRepEmail: 'E-mail do representante legal', legalRepPhone: 'Telefone do representante legal',
    };
    const fields = (Object.keys(labels) as (keyof Organization)[]).filter((k) => !org[k]).map((k) => labels[k]!);
    const sent = await this.docs.find({ select: { type: true }, where: { organizationId: org.id, supersededAt: IsNull() } });
    const have = new Set(sent.map((d) => d.type));
    const documents = REQUIRED_DOCUMENT_TYPES.filter((t) => !have.has(t));
    return { fields, documents };
  }

  async updateMine(user: RequestUser, dto: UpdateOrganizationDto, ip?: string) {
    const org = await this.ofOwner(user.id, ip);
    if (org.status === OrganizationStatus.SUSPENSA) throw new ForbiddenException('Organização suspensa.');
    if (org.status === OrganizationStatus.EM_ANALISE) throw new BadRequestException('Cadastro em análise não pode ser alterado.');
    // Normaliza (o pipe valida a versão normalizada, mas entrega o corpo original).
    const clean: Record<string, unknown> = { ...dto };
    for (const k of ['phone', 'zip', 'legalRepCpf', 'legalRepPhone'] as const) if (dto[k] !== undefined) clean[k] = onlyDigits(dto[k]);
    if (dto.state) clean.state = dto.state.toUpperCase();
    const changed = Object.keys(clean).filter((k) => clean[k] !== undefined && clean[k] !== (org as any)[k]);
    Object.assign(org, clean);
    // Dados cadastrais mudaram depois da aprovação → volta para análise.
    if (org.status === OrganizationStatus.APROVADA && changed.some((k) => ['legalName', 'zip', 'street', 'city', 'state', 'legalRepName', 'legalRepCpf'].includes(k))) {
      org.status = OrganizationStatus.INCOMPLETO;
      org.statusReason = 'Dados institucionais alterados após a aprovação; reenvie para análise.';
    }
    await this.orgs.save(org);
    await this.audit.log({ actor: user, action: 'ORG_UPDATED', entityType: 'organization', entityId: org.id, organizationId: org.id, metadata: { fields: changed }, ip });
    return { ...org, missing: await this.missingForSubmission(org) };
  }

  async submit(user: RequestUser, ip?: string) {
    const org = await this.ofOwner(user.id, ip);
    if (![OrganizationStatus.INCOMPLETO, OrganizationStatus.AGUARDANDO_DOCUMENTACAO, OrganizationStatus.REPROVADA].includes(org.status)) {
      throw new BadRequestException('A organização não pode ser enviada para análise neste estado.');
    }
    const missing = await this.missingForSubmission(org);
    if (missing.fields.length || missing.documents.length) {
      throw new BadRequestException({ message: 'Cadastro incompleto.', missing });
    }
    org.status = OrganizationStatus.EM_ANALISE;
    org.statusReason = null;
    await this.orgs.save(org);
    // Consultas automáticas: falhas viram registro INDISPONIVEL; nunca aprovam nem derrubam o envio.
    const results = await this.checks.runAll(org, null);
    await this.audit.log({ actor: user, action: 'ORG_SUBMITTED', entityType: 'organization', entityId: org.id, organizationId: org.id, metadata: { checks: Object.fromEntries(results.map((r) => [r.source, r.status])) }, ip });
    return org;
  }

  async uploadDocument(user: RequestUser, dto: UploadDocumentDto, file: Express.Multer.File | undefined, ip?: string) {
    const org = await this.ofOwner(user.id, ip);
    if (org.status === OrganizationStatus.SUSPENSA) throw new ForbiddenException('Organização suspensa.');
    if (org.status === OrganizationStatus.EM_ANALISE) throw new BadRequestException('Cadastro em análise: aguarde a decisão ou o pedido de documentos.');
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
    const [documents, history, latest, checkHistory, missing, owner] = await Promise.all([
      this.docs.find({ select: DOC_COLUMNS, where: { organizationId: id }, order: { createdAt: 'DESC' } }),
      this.validations.find({ where: { organizationId: id }, order: { createdAt: 'DESC' } }),
      this.checks.latest(id),
      this.checks.history(id),
      this.missingForSubmission(org),
      this.users.findOne({ select: { id: true, name: true, email: true }, where: { id: org.ownerId } }),
    ]);
    return { ...org, owner, documents, validations: history, externalChecks: latest, externalCheckHistory: checkHistory, missing };
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
      const missing = await this.missingForSubmission(org);
      if (missing.documents.length) throw new BadRequestException(`Documentos obrigatórios ausentes: ${missing.documents.join(', ')}.`);
      // Consultas indisponíveis/com alerta nunca aprovam sozinhas: só com justificativa explícita do analista.
      const latest = await this.checks.latest(id);
      // Fontes essenciais (cadastro e sanções) precisam ter respondido; Mapa das OSCs e Transferegov são complementares.
      const blockers = [
        ...[CheckSource.BRASILAPI, CheckSource.PORTAL_TRANSPARENCIA]
          .filter((src) => latest.find((c) => c.source === src)?.status !== CheckStatus.OK && latest.find((c) => c.source === src)?.status !== CheckStatus.ALERTA)
          .map((src) => `consulta ${src} indisponível ou não realizada`),
        ...latest.filter((c) => c.status === CheckStatus.ALERTA).map((c) => `alerta em ${c.source}`),
      ];
      if (blockers.length && !dto.overrideReason) {
        throw new BadRequestException({ message: `Aprovação bloqueada: ${blockers.join('; ')}. Reexecute as consultas ou informe overrideReason.`, blockers });
      }
    }
    await this.dataSource.transaction(async (m) => {
      await m.update(Organization, id, {
        status: approve ? OrganizationStatus.APROVADA : OrganizationStatus.REPROVADA,
        statusReason: approve ? null : dto.reason,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      });
      await m.insert(OrganizationValidation, { organizationId: id, decision: dto.decision, reason: dto.reason ?? dto.overrideReason ?? null, reviewedBy: admin.id });
      await this.audit.log({ actor: admin, action: approve ? 'ORG_APPROVED' : 'ORG_REJECTED', entityType: 'organization', entityId: id, organizationId: id, metadata: { reason: dto.reason ?? null, overrideReason: dto.overrideReason ?? null }, ip }, m);
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

  /** Pede documentos complementares: ONG volta a poder enviar arquivos e reenviar para análise. */
  async requestDocuments(admin: RequestUser, id: string, dto: RequestDocumentsDto, ip?: string) {
    const org = await this.orgs.findOneBy({ id });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    if (org.status !== OrganizationStatus.EM_ANALISE) throw new BadRequestException('A organização não está em análise.');
    await this.dataSource.transaction(async (m) => {
      await m.update(Organization, id, { status: OrganizationStatus.AGUARDANDO_DOCUMENTACAO, statusReason: dto.message, reviewedBy: admin.id, reviewedAt: new Date() });
      await m.insert(OrganizationValidation, { organizationId: id, decision: 'SOLICITAR_DOCUMENTOS', reason: dto.message, reviewedBy: admin.id });
      await this.audit.log({ actor: admin, action: 'ORG_DOCUMENTS_REQUESTED', entityType: 'organization', entityId: id, organizationId: id, metadata: { message: dto.message }, ip }, m);
    });
    return this.orgs.findOneByOrFail({ id });
  }

  async rerunChecks(admin: RequestUser, id: string, ip?: string) {
    const org = await this.orgs.findOneBy({ id });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    const results = await this.checks.runAll(org, admin.id);
    await this.audit.log({ actor: admin, action: 'ORG_CHECKS_RERUN', entityType: 'organization', entityId: id, organizationId: id, metadata: { checks: Object.fromEntries(results.map((r) => [r.source, r.status])) }, ip });
    return results;
  }

  checksStatus(userId: number) {
    return this.ofOwner(userId).then(async (org) => ({
      ...org, missing: await this.missingForSubmission(org),
      // A ONG vê apenas se houve consulta e quando, não o conteúdo bruto das fontes.
      checks: (await this.checks.latest(org.id)).map((c) => ({ source: c.source, queriedAt: c.queriedAt })),
    }));
  }

  /** Vitrine pública: somente ONGs aprovadas e somente dados institucionais públicos. */
  async listPublic() {
    const rows = await this.orgs.find({ where: { status: OrganizationStatus.APROVADA }, order: { reviewedAt: 'DESC' } });
    return rows.map((o) => this.toPublic(o));
  }

  async getPublic(id: string) {
    const o = await this.orgs.findOneBy({ id, status: OrganizationStatus.APROVADA });
    if (!o) throw new NotFoundException('Organização não encontrada.');
    return this.toPublic(o);
  }

  private toPublic(o: Organization) {
    return { id: o.id, name: o.tradeName ?? o.legalName, legalName: o.legalName, cnpj: o.cnpj, description: o.description, city: o.city, state: o.state, validatedAt: o.reviewedAt };
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
