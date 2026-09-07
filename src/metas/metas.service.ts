import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Meta } from './entities/meta.entity';
import { User, UserType } from '../users/entities/user.entity';
import { CreateMetaDto } from './dto/create-meta.dto';

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
      ongId: ongId,
      currentAmount: 0,
      currentQuantity: 0,
      active: true,
      details: data.details,
      priority: data.priority,
      image: data.image,
    });

    return this.metaRepo.save(meta);
  }

}