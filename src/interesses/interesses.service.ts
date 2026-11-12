import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { Interesse } from './entities/interesse.entity';

@Injectable()
export class InteressesService {
  constructor(
    @InjectRepository(Interesse)
    private readonly interessesRepository: Repository<Interesse>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async listarDaOng(ongId: number) {
    await this.validarOngAtiva(ongId);

    return this.interessesRepository.find({
      where: { ongId },
      relations: { doador: true },
      select: {
        id: true,
        doadorId: true,
        ongId: true,
        createdAt: true,
        doador: {
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
    await this.validarOngAtiva(ongId);

    const total = await this.interessesRepository.count({
      where: { doadorId, ongId },
    });

    return { interessado: total > 0 };
  }

  async demonstrar(doadorId: number, ongId: number) {
    await this.validarDoadorAtivo(doadorId);
    await this.validarOngAtiva(ongId);

    const existente = await this.interessesRepository.findOne({
      where: { doadorId, ongId },
    });

    if (!existente) {
      const interesse = this.interessesRepository.create({ doadorId, ongId });
      await this.interessesRepository.save(interesse);
    }

    return { interessado: true };
  }

  async cancelar(doadorId: number, ongId: number) {
    await this.validarDoadorAtivo(doadorId);
    await this.interessesRepository.delete({ doadorId, ongId });

    return { interessado: false };
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
