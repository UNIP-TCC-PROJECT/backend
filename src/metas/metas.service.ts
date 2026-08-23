import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Meta } from './entities/meta.entity';
import { CreateMetaDto } from './dto/create-meta.dto';
import { UpdateMetaDto } from './dto/update-meta.dto';  // ← CORRIGIDO

@Injectable()
export class MetasService {
  constructor(
    @InjectRepository(Meta)
    private metaRepository: Repository<Meta>,
  ) {}

  async create(createMetaDto: CreateMetaDto, ongId: number) {
    const meta = this.metaRepository.create({
      ...createMetaDto,
      ongId,
    });
    return this.metaRepository.save(meta);
  }

  async findByOng(ongId: number) {
    return this.metaRepository.find({
      where: { ongId },
      order: { id: 'DESC' },
    });
  }

  async findOne(id: number) {
    const meta = await this.metaRepository.findOne({
      where: { id },
    });
    
    if (!meta) {
      throw new NotFoundException('Meta não encontrada');
    }
    
    return meta;
  }

  async update(id: number, updateMetaDto: UpdateMetaDto, ongId: number) {
    const meta = await this.findOne(id);
    
    if (meta.ongId !== ongId) {
      throw new ForbiddenException('Você não tem permissão para editar esta meta');
    }
    
    Object.assign(meta, updateMetaDto);
    return this.metaRepository.save(meta);
  }

  async remove(id: number, ongId: number) {
    const meta = await this.findOne(id);
    
    if (meta.ongId !== ongId) {
      throw new ForbiddenException('Você não tem permissão para deletar esta meta');
    }
    
    return this.metaRepository.remove(meta);
  }
}