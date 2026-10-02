import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reviews } from './entities/reviews.entity';
import { User, UserType, UserStatus } from '../users/entities/user.entity';

const MAX_COMENTARIO = 500;

export interface ReviewResult {
  id: number;
  averageRating: number;
  totalReviews: number;
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Reviews)
    private reviewsRepository: Repository<Reviews>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async review(
    ongId: number,
    doadorId: number,
    nota: number,
    comentario?: string,
  ): Promise<ReviewResult> {
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      throw new BadRequestException(
        'A nota deve ser um número inteiro entre 1 e 5.',
      );
    }

    if (comentario !== undefined && typeof comentario !== 'string') {
      throw new BadRequestException('O comentário deve ser um texto.');
    }

    const comentarioLimpo = comentario?.trim();

    if (comentarioLimpo && comentarioLimpo.length > MAX_COMENTARIO) {
      throw new BadRequestException(
        `O comentário deve ter no máximo ${MAX_COMENTARIO} caracteres.`,
      );
    }

    return this.userRepository.manager.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const reviewsRepository = manager.getRepository(Reviews);

      const ong = await userRepository.findOne({
        where: { id: ongId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!ong) {
        throw new NotFoundException('ONG não encontrada.');
      }

      if (ong.type !== UserType.ONG) {
        throw new BadRequestException('Esse usuário não é uma ONG.');
      }

      if (ong.status !== UserStatus.ATIVO) {
        throw new ForbiddenException('Esta ONG não está ativa.');
      }

      const doador = await userRepository.findOne({
        where: { id: doadorId },
      });

      if (!doador) {
        throw new NotFoundException('Doador não encontrado.');
      }

      if (doador.type !== UserType.DOADOR) {
        throw new BadRequestException('Esse usuário não é um doador.');
      }

      if (doador.status !== UserStatus.ATIVO) {
        throw new ForbiddenException('Este doador não está ativo.');
      }

      const existingReview = await reviewsRepository.findOne({
        where: { ong: { id: ongId }, doador: { id: doadorId } },
      });

      if (existingReview) {
        existingReview.nota = nota;
        // undefined mantém o comentário atual; texto vazio remove.
        if (comentarioLimpo !== undefined) {
          existingReview.comentario = comentarioLimpo || null;
        }
        await reviewsRepository.save(existingReview);
      } else {
        const newReview = reviewsRepository.create({
          nota,
          comentario: comentarioLimpo || null,
          ong,
          doador,
        });
        await reviewsRepository.save(newReview);
      }

      const reviews = await reviewsRepository.find({
        where: { ong: { id: ongId } },
      });

      const totalReviews = reviews.length;
      const sum = reviews.reduce((total, review) => total + review.nota, 0);
      const averageRating =
        totalReviews > 0 ? Number((sum / totalReviews).toFixed(2)) : 0;

      await userRepository.update(ongId, {
        averageRating,
        totalReviews,
      });

      return {
        id: ongId,
        averageRating,
        totalReviews,
      };
    });
  }

  // Consulta pública: expõe só nota, texto e nome de exibição do autor.
  async listComments(ongId: number) {
    const reviews = await this.reviewsRepository.find({
      where: { ong: { id: ongId } },
      relations: { doador: true },
      order: { createdAt: 'DESC' },
    });

    return reviews
      .filter((r) => !!r.comentario)
      .map((r) => ({
        id: r.id,
        nota: r.nota,
        comentario: r.comentario,
        createdAt: r.createdAt,
        autorNome: r.doador?.name ?? 'Doador',
      }));
  }

  async findMine(ongId: number, doadorId: number) {
    const review = await this.reviewsRepository.findOne({
      where: { ong: { id: ongId }, doador: { id: doadorId } },
    });

    if (!review) {
      return null;
    }

    return { id: review.id, nota: review.nota, comentario: review.comentario };
  }
}
