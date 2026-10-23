import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Favorito } from './entities/favorito.entity';
import {
  User,
  UserStatus,
  UserType,
} from '../users/entities/user.entity';

@Injectable()
export class FavoritosService {
  constructor(
    @InjectRepository(Favorito)
    private readonly favoritosRepository: Repository<Favorito>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async listar(doadorId: number) {
    await this.validarDoadorAtivo(doadorId);

    return this.favoritosRepository.find({
      where: { doadorId },
      relations: { ong: true },
      select: {
        id: true,
        ongId: true,
        createdAt: true,
        ong: {
          id: true,
          name: true,
          profileImage: true,
        },
      },
      order: { createdAt: 'DESC' },
    });
  }

  async verificar(doadorId: number, ongId: number) {
    await this.validarDoadorAtivo(doadorId);

    const total = await this.favoritosRepository.count({
      where: { doadorId, ongId },
    });

    return { favoritada: total > 0 };
  }

  async adicionar(doadorId: number, ongId: number) {
    await this.validarDoadorAtivo(doadorId);
    await this.validarOngAtiva(ongId);

    const existente = await this.favoritosRepository.findOne({
      where: { doadorId, ongId },
    });

    if (existente) {
      return { favoritada: true };
    }

    const favorito = this.favoritosRepository.create({ doadorId, ongId });
    await this.favoritosRepository.save(favorito);

    return { favoritada: true };
  }

  async remover(doadorId: number, ongId: number) {
    await this.validarDoadorAtivo(doadorId);

    await this.favoritosRepository.delete({ doadorId, ongId });

    return { favoritada: false };
  }

  private async validarDoadorAtivo(doadorId: number) {
    const doador = await this.usersRepository.findOne({
      where: {
        id: doadorId,
        type: UserType.DOADOR,
        status: UserStatus.ATIVO,
      },
      select: { id: true },
    });

    if (!doador) {
      throw new ForbiddenException('Ação permitida somente para doadores ativos.');
    }
  }

  private async validarOngAtiva(ongId: number) {
    const ong = await this.usersRepository.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
        status: UserStatus.ATIVO,
      },
      select: { id: true },
    });

    if (!ong) {
      throw new NotFoundException('ONG ativa não encontrada.');
    }
  }
}