import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  FileTypeValidator,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Publicacao } from './entities/publicacao.entity';
import { PublicacoesQueryDto } from './dto/publicacoes-query.dto';
import { CreatePublicacaoDto } from './dto/create-publicacao.dto';
import { User, UserType, UserStatus } from '../users/entities/user.entity';

@Injectable()
export class PublicacoesService {
  private readonly logger = new Logger(PublicacoesService.name);
  constructor(
    @InjectRepository(Publicacao)
    private readonly publicacoesRepository: Repository<Publicacao>,

    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(
    ongId: number,
    dto: CreatePublicacaoDto,
    image?: Express.Multer.File,
  ) {
    const ong = await this.usersRepository.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
        status: UserStatus.ATIVO,
      },
      select: ['id'],
    });

    if (!ong) {
      throw new ForbiddenException(
        'Somente uma ONG ativa pode criar publicações.',
      );
    }

    if (!image?.buffer || image.size === 0) {
      throw new BadRequestException('Envie uma imagem.');
    }

    if (image.size > 2 * 1024 * 1024) {
      throw new BadRequestException('A imagem deve ter no máximo 2 MB.');
    }

    const extensions = new Map([
      ['image/jpeg', '.jpg'],
      ['image/png', '.png'],
      ['image/webp', '.webp'],
    ]);

    const extension = extensions.get(image.mimetype);

    if (!extension) {
      throw new BadRequestException('Selecione uma imagem JPG, PNG ou WebP.');
    }

    const validator = new FileTypeValidator({
      fileType: new RegExp(`^${image.mimetype}$`),
    });

    if (!(await validator.isValid(image))) {
      throw new BadRequestException(
        'O conteúdo do arquivo não corresponde a uma imagem válida do formato informado.',
      );
    }

    const directory = join(process.cwd(), 'uploads', 'publicacoes');
    const filename = `${randomUUID()}${extension}`;
    const filePath = join(directory, filename);

    await mkdir(directory, { recursive: true });
    await writeFile(filePath, image.buffer, { flag: 'wx' });

    try {
      const publicacao = this.publicacoesRepository.create({
        ongId: ong.id,
        description: dto.description,
        imageUrl: `/uploads/publicacoes/${filename}`,
      });

      return await this.publicacoesRepository.save(publicacao);
    } catch (error) {
      try {
        await unlink(filePath);
      } catch {
        this.logger.error(
          `Não foi possível limpar a imagem após falha ao salvar: ${filename}`,
        );
      }

      throw error;
    }
  }

  async findAll(query: PublicacoesQueryDto) {
  const { page, limit } = query;

  const [items, total] = await this.publicacoesRepository.findAndCount({
    relations: { ong: true },
    select: {
      id: true,
      ongId: true,
      description: true,
      imageUrl: true,
      createdAt: true,
      ong: {
        id: true,
        name: true,
        profileImage: true,
      },
    },
    order: {
      createdAt: "DESC",
      id: "DESC",
    },
    skip: (page - 1) * limit,
    take: limit,
  });

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

  async findByOng(ongId: number, query: PublicacoesQueryDto) {
    const ong = await this.usersRepository.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
      },
      select: ['id'],
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    const { page, limit } = query;

    const [items, total] = await this.publicacoesRepository.findAndCount({
      where: { ongId },
      select: ['id', 'ongId', 'description', 'imageUrl', 'createdAt'],
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: number) {
  const publicacao = await this.publicacoesRepository.findOne({
    where: { id },
    relations: { ong: true },
    select: {
      id: true,
      ongId: true,
      description: true,
      imageUrl: true,
      createdAt: true,
      ong: {
        id: true,
        name: true,
        profileImage: true,
      },
    },
  });

  if (!publicacao) {
    throw new NotFoundException("Publicação não encontrada.");
  }

  return publicacao;
}
}
