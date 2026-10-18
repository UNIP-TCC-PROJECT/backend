import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Meta } from './entities/meta.entity';
import { User, UserType } from '../users/entities/user.entity';
import { CreateMetaDto } from './dto/create-meta.dto';
import { UpdateMetaDto } from './dto/update-meta.dto';

@Injectable()
export class MetasService {
  constructor(
    @InjectRepository(Meta)
    private metaRepo: Repository<Meta>,

    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async findByOng(ongId: number) {
    const ong = await this.userRepo.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
      },
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    return this.metaRepo.find({
      where: {
        ongId,
        active: true,
      },
      order: {
        id: 'DESC',
      },
    });
  }

  async findMine(ongId: number) {
    return this.metaRepo.find({
      where: {
        ongId,
      },
      order: {
        id: 'DESC',
      },
    });
  }

  async create(ongId: number, data: CreateMetaDto) {
    const ong = await this.userRepo.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
      },
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

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
    });

    return this.metaRepo.save(meta);
  }

  async update(id: number, ongId: number, data: UpdateMetaDto) {
    const meta = await this.findOwnedMeta(id, ongId);

    if (data.title !== undefined) meta.title = data.title;
    if (data.description !== undefined) meta.description = data.description;
    if (data.details !== undefined) meta.details = data.details;
    if (data.type !== undefined) meta.type = data.type;
    if (data.priority !== undefined) meta.priority = data.priority;
    if (data.targetAmount !== undefined) meta.targetAmount = data.targetAmount;
    if (data.targetQuantity !== undefined)
      meta.targetQuantity = data.targetQuantity;
    if (data.unit !== undefined) meta.unit = data.unit;
    if (data.deadline !== undefined) meta.deadline = new Date(data.deadline);
    if (data.image !== undefined) meta.image = data.image;

    return this.metaRepo.save(meta);
  }

  async deactivate(id: number, ongId: number) {
    const meta = await this.findOwnedMeta(id, ongId);

    meta.active = false;

    return this.metaRepo.save(meta);
  }

  private async findOwnedMeta(id: number, ongId: number) {
    const meta = await this.metaRepo.findOne({ where: { id } });

    if (!meta) {
      throw new NotFoundException('Meta não encontrada');
    }

    if (meta.ongId !== ongId) {
      throw new ForbiddenException('Esta meta não pertence a esta ONG');
    }

    return meta;
  }
}