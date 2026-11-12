import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Denuncia, DenunciaStatus, DenunciaTipoAlvo } from './entities/denuncia.entity';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { Reviews } from '../reviews/entities/reviews.entity';
import { ReviewDenunciaDto } from './dto/review-denuncia.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DenunciasService {
  constructor(
    @InjectRepository(Denuncia)
    private denunciasRepository: Repository<Denuncia>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Reviews)
    private reviewsRepository: Repository<Reviews>,
    private audit: AuditService,
    private dataSource: DataSource,
  ) {}

  async listForAdmin(status?: DenunciaStatus, includeClosed = false, ongId?: number) {
    const query = this.denunciasRepository
      .createQueryBuilder('denuncia')
      .leftJoinAndSelect('denuncia.autor', 'autor')
      .select([
        'denuncia.id',
        'denuncia.autorId',
        'denuncia.tipoAlvo',
        'denuncia.alvoId',
        'denuncia.motivo',
        'denuncia.contexto',
        'denuncia.status',
        'denuncia.reviewNote',
        'denuncia.reviewedBy',
        'denuncia.reviewedAt',
        'denuncia.createdAt',
        'autor.id',
        'autor.name',
        'autor.type',
      ])
      .orderBy('denuncia.createdAt', 'DESC')
      .take(200);

    if (status) query.where('denuncia.status = :status', { status });
    else if (!includeClosed) query.where('denuncia.status IN (:...statuses)', {
      statuses: [DenunciaStatus.PENDENTE, DenunciaStatus.EM_ANALISE],
    });
    if (ongId !== undefined) {
      query.andWhere(new Brackets((related) => {
        related.where('denuncia.tipoAlvo = :ong AND denuncia.alvoId = :ongId', {
          ong: DenunciaTipoAlvo.ONG,
          ongId,
        }).orWhere("denuncia.tipoAlvo = :comentario AND denuncia.contexto ->> 'ongId' = :contextOngId", {
          comentario: DenunciaTipoAlvo.COMENTARIO,
          contextOngId: String(ongId),
        });
      }));
    }

    return query.getMany();
  }

  async reviewByAdmin(adminId: number, id: number, dto: ReviewDenunciaDto, ip?: string) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Denuncia);
      const denuncia = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!denuncia) throw new NotFoundException('Denúncia não encontrada.');
      if (![DenunciaStatus.PENDENTE, DenunciaStatus.EM_ANALISE].includes(denuncia.status)) {
        throw new BadRequestException('Esta denúncia já foi concluída.');
      }
      if (dto.decision !== DenunciaStatus.EM_ANALISE && !dto.note?.trim()) {
        throw new BadRequestException('Informe a justificativa para concluir a análise.');
      }

      denuncia.status = dto.decision;
      denuncia.reviewNote = dto.note?.trim() || null;
      denuncia.reviewedBy = adminId;
      denuncia.reviewedAt = new Date();
      await repository.save(denuncia);
      await this.audit.log({
        actor: { id: adminId, type: UserType.ADMIN },
        action: 'REPORT_REVIEWED',
        entityType: 'denuncia',
        entityId: id,
        metadata: { decision: denuncia.status, note: denuncia.reviewNote },
        ip,
      }, manager);

      return {
        id: denuncia.id,
        status: denuncia.status,
        reviewNote: denuncia.reviewNote,
        reviewedBy: denuncia.reviewedBy,
        reviewedAt: denuncia.reviewedAt,
      };
    });
  }

  // Retorna apenas o necessário ao denunciante; nada de dados de terceiros.
  async create(autorId: number, dto: CreateDenunciaDto) {
    const autor = await this.userRepository.findOne({ where: { id: autorId } });

    if (!autor) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const expectedAuthorType = dto.tipoAlvo === DenunciaTipoAlvo.DOADOR
      ? UserType.ONG
      : UserType.DOADOR;
    if (autor.type !== expectedAuthorType) {
      throw new ForbiddenException(
        dto.tipoAlvo === DenunciaTipoAlvo.DOADOR
          ? 'Somente ONGs podem denunciar doadores.'
          : 'Somente doadores podem denunciar ONGs ou comentários.',
      );
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

    if (dto.tipoAlvo === DenunciaTipoAlvo.DOADOR) {
      const doador = await this.userRepository.findOne({
        where: { id: dto.alvoId, type: UserType.DOADOR },
      });

      if (!doador) {
        throw new NotFoundException('Doador não encontrado.');
      }

      return {
        doadorId: doador.id,
        nome: doador.name,
        statusConta: doador.status,
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
