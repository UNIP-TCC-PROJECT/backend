import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Denuncia, DenunciaStatus, DenunciaTipoAlvo } from './entities/denuncia.entity';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { Reviews } from '../reviews/entities/reviews.entity';

@Injectable()
export class DenunciasService {
  constructor(
    @InjectRepository(Denuncia)
    private denunciasRepository: Repository<Denuncia>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Reviews)
    private reviewsRepository: Repository<Reviews>,
  ) {}

  // Retorna apenas o necessário ao denunciante; nada de dados de terceiros.
  async create(autorId: number, dto: CreateDenunciaDto) {
    const autor = await this.userRepository.findOne({ where: { id: autorId } });

    if (!autor) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (autor.type !== UserType.DOADOR) {
      throw new ForbiddenException('Somente doadores podem enviar denúncias.');
    }

    if (autor.status !== UserStatus.ATIVO) {
      throw new ForbiddenException('Sua conta não está ativa.');
    }

    const contexto = await this.buildContexto(dto, autorId);

    const duplicada = await this.denunciasRepository.findOne({
      where: {
        autorId,
        tipoAlvo: dto.tipoAlvo,
        alvoId: dto.alvoId,
        status: DenunciaStatus.PENDENTE,
      },
    });

    if (duplicada) {
      throw new ConflictException(
        'Você já possui uma denúncia pendente para este item.',
      );
    }

    try {
      const denuncia = await this.denunciasRepository.save(
        this.denunciasRepository.create({
          autorId,
          tipoAlvo: dto.tipoAlvo,
          alvoId: dto.alvoId,
          motivo: dto.motivo,
          contexto,
          status: DenunciaStatus.PENDENTE,
        }),
      );

      return {
        id: denuncia.id,
        status: denuncia.status,
        createdAt: denuncia.createdAt,
      };
    } catch (err: any) {
      // Corrida entre requisições simultâneas: o índice único garante a regra.
      if (err?.code === '23505') {
        throw new ConflictException(
          'Você já possui uma denúncia pendente para este item.',
        );
      }
      throw err;
    }
  }

  private async buildContexto(
    dto: CreateDenunciaDto,
    autorId: number,
  ): Promise<Record<string, unknown>> {
    if (dto.tipoAlvo === DenunciaTipoAlvo.ONG) {
      const ong = await this.userRepository.findOne({
        where: { id: dto.alvoId },
      });

      if (!ong || ong.type !== UserType.ONG) {
        throw new NotFoundException('ONG não encontrada.');
      }

      return {
        ongId: ong.id,
        nome: ong.name,
        email: ong.email,
        cnpj: ong.cnpj ?? null,
        descricao: ong.description ?? null,
        statusConta: ong.status,
      };
    }

    if (dto.tipoAlvo === DenunciaTipoAlvo.COMENTARIO) {
      const review = await this.reviewsRepository.findOne({
        where: { id: dto.alvoId },
        relations: { ong: true, doador: true },
      });

      if (!review) {
        throw new NotFoundException('Comentário não encontrado.');
      }

      if (review.doador?.id === autorId) {
        throw new ForbiddenException(
          'Você não pode denunciar o seu próprio comentário.',
        );
      }

      if (!review.comentario) {
        throw new NotFoundException('Comentário não encontrado.');
      }

      return {
        avaliacaoId: review.id,
        ongId: review.ong?.id ?? null,
        ongNome: review.ong?.name ?? null,
        autorComentarioId: review.doador?.id ?? null,
        autorComentarioNome: review.doador?.name ?? null,
        nota: review.nota,
        comentario: review.comentario,
        comentarioCriadoEm: review.createdAt,
      };
    }

    throw new BadRequestException('Tipo de alvo inválido.');
  }
}
