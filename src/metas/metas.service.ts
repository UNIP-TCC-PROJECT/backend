import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Meta } from './entities/meta.entity';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { CreateMetaDto } from './dto/create-meta.dto';
import { UpdateMetaDto } from './dto/update-meta.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { ContentReviewStatus, validateContentDecision, type ContentReviewDecision } from '../common/content-moderation';
import type { RequestUser } from '../common/request-context';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class MetasService {
  constructor(
    @InjectRepository(Meta)
    private metaRepo: Repository<Meta>,

    @InjectRepository(User)
    private userRepo: Repository<User>,
    private organizations: OrganizationsService,
    private audit: AuditService,
  ) {}

  async findByOng(ongId: number) {
    const ong = await this.userRepo.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
        status: UserStatus.ATIVO,
        preVerificacaoCnpj: true,
      },
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    return this.metaRepo.find({
      where: {
        ongId,
        active: true,
        reviewStatus: ContentReviewStatus.APROVADA,
      },
      order: {
        id: 'DESC',
      },
    });
  }

  async findMine(ongId: number) {
    return this.metaRepo.find({
      where: { ongId },
      order: { id: 'DESC' },
    });
  }

  async findOne(id: number, requesterId: number) {
    const meta = await this.metaRepo.findOne({
      where: { id },
    });

    if (!meta) {
      throw new NotFoundException('Meta não encontrada');
    }

    if (meta.reviewStatus !== ContentReviewStatus.APROVADA && meta.ongId !== requesterId)
      throw new NotFoundException('Meta não encontrada');

    if (meta.reviewStatus === ContentReviewStatus.APROVADA) {
      const owner = await this.userRepo.findOne({ where: { id: meta.ongId, type: UserType.ONG, status: UserStatus.ATIVO, preVerificacaoCnpj: true }, select: { id: true } });
      if (!owner) throw new NotFoundException('Meta não encontrada');
    }

    return meta;
  }

  async create(ongId: number, data: CreateMetaDto) {
    const access = await this.organizations.contentAccess(ongId, true);
    if (!access.canSubmit) throw new ForbiddenException('Confira o CNPJ da organização antes de cadastrar metas.');

    const meta = this.metaRepo.create({
      title: data.title,
      description: data.description,
      type: data.type,
      targetAmount: data.targetAmount,
      targetQuantity: data.targetQuantity,
      unit: data.unit,
      deadline: data.deadline
        ? new Date(data.deadline)
        : undefined,
      ongId,
      currentAmount: 0,
      currentQuantity: 0,
      active: true,
      details: data.details,
      priority: data.priority,
      image: data.image,
      reviewStatus: access.canPublishWithoutReview ? ContentReviewStatus.APROVADA : ContentReviewStatus.PENDENTE,
      reviewedAt: access.canPublishWithoutReview ? new Date() : null,
    });

    return this.metaRepo.save(meta);
  }

  async update(id: number, ongId: number, data: UpdateMetaDto) {
    const access = await this.organizations.contentAccess(ongId, true);
    if (!access.canSubmit) throw new ForbiddenException('Confira o CNPJ da organização antes de editar metas.');
    const meta = await this.findOwnedMeta(id, ongId);

    if (data.title !== undefined) meta.title = data.title;
    if (data.description !== undefined) {
      meta.description = data.description;
    }
    if (data.details !== undefined) meta.details = data.details;
    if (data.type !== undefined) meta.type = data.type;
    if (data.priority !== undefined) meta.priority = data.priority;
    if (data.targetAmount !== undefined) {
      meta.targetAmount = data.targetAmount;
    }
    if (data.targetQuantity !== undefined) {
      meta.targetQuantity = data.targetQuantity;
    }
    if (data.unit !== undefined) meta.unit = data.unit;
    if (data.deadline !== undefined) {
      meta.deadline = new Date(data.deadline);
    }
    if (data.image !== undefined) meta.image = data.image;

    if (!access.canPublishWithoutReview) {
      meta.reviewStatus = ContentReviewStatus.PENDENTE;
      meta.reviewedAt = null;
      meta.reviewedBy = null;
      meta.reviewReason = null;
    }

    return this.metaRepo.save(meta);
  }

  async deactivate(id: number, ongId: number) {
    const meta = await this.findOwnedMeta(id, ongId);

    meta.active = false;

    return this.metaRepo.save(meta);
  }

  private async findOwnedMeta(id: number, ongId: number) {
    const meta = await this.metaRepo.findOne({ where: { id } });
    if (!meta) throw new NotFoundException('Meta não encontrada');

    if (meta.ongId !== ongId) {
      throw new ForbiddenException(
        'Esta meta não pertence a esta ONG',
      );
    }

    return meta;
  }

  listPendingReview() {
    return this.metaRepo.find({ where: { reviewStatus: ContentReviewStatus.PENDENTE }, relations: { ong: true }, order: { id: 'ASC' }, take: 200 });
  }

  async review(admin: RequestUser, id: number, decision: ContentReviewDecision, reason?: string) {
    validateContentDecision(decision, reason);
    const meta = await this.metaRepo.findOneBy({ id });
    if (!meta) throw new NotFoundException('Meta não encontrada.');
    if (meta.reviewStatus !== ContentReviewStatus.PENDENTE) throw new ForbiddenException('A meta já foi analisada.');
    meta.reviewStatus = decision === 'APROVAR' ? ContentReviewStatus.APROVADA : ContentReviewStatus.REPROVADA;
    meta.reviewReason = decision === 'REPROVAR' ? reason!.trim() : null;
    meta.reviewedBy = admin.id;
    meta.reviewedAt = new Date();
    await this.metaRepo.save(meta);
    await this.audit.log({ actor: admin, action: 'META_REVIEWED', entityType: 'meta', entityId: String(id), metadata: { decision, reason: meta.reviewReason } });
    return { id, reviewStatus: meta.reviewStatus, reviewReason: meta.reviewReason };
  }
}
