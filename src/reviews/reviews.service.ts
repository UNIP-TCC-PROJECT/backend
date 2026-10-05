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
    comentario?: string | null,
  ): Promise<ReviewResult> {
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      throw new BadRequestException(
        'A nota deve ser um número inteiro entre 1 e 5.',
      );
    }

    if (comentario !== undefined && comentario !== null) {
      if (typeof comentario !== 'string') {
        throw new BadRequestException('O comentário deve ser um texto.');
      }

      comentario = comentario.trim();

      if (Array.from(comentario).length > 100) {
        throw new BadRequestException(
          'O comentário deve ter no máximo 100 caracteres.',
        );
      }

      if (comentario === '') {
        comentario = null;
      }
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

        if (comentario !== undefined) {
          existingReview.comentario = comentario;
        }

        await reviewsRepository.save(existingReview);
      } else {
        const newReview = reviewsRepository.create({
          nota,
          comentario: comentario ?? null,
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

  async findMyReview(ongId: number, doadorId: number) {
    const doador = await this.userRepository.findOne({
      where: {
        id: doadorId,
        type: UserType.DOADOR,
        status: UserStatus.ATIVO,
      },
      select: ['id'],
    });

    if (!doador) {
      throw new ForbiddenException(
        'Somente doadores ativos podem consultar sua avaliação.',
      );
    }

    const ong = await this.userRepository.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
      },
      select: ['id', 'status'],
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada.');
    }

    if (ong.status !== UserStatus.ATIVO) {
      throw new ForbiddenException('Esta ONG não está ativa.');
    }

    const review = await this.reviewsRepository.findOne({
      where: {
        ong: { id: ongId },
        doador: { id: doadorId },
      },
      select: ['id', 'nota', 'comentario', 'createdAt', 'updatedAt'],
    });

    if (!review) {
      return null;
    }

    return {
      id: review.id,
      nota: review.nota,
      comentario: review.comentario,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  async findAllByOng(ongId: number, page: number, limit: number) {
    const ong = await this.userRepository.findOne({
      where: {
        id: ongId,
        type: UserType.ONG,
      },
      select: ['id', 'status'],
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada.');
    }

    if (ong.status !== UserStatus.ATIVO) {
      throw new ForbiddenException('Esta ONG não está ativa.');
    }

    const [reviews, total] = await this.reviewsRepository.findAndCount({
      where: {
        ong: { id: ongId },
      },
      relations: {
        doador: true,
      },
      select: {
        id: true,
        nota: true,
        comentario: true,
        createdAt: true,
        updatedAt: true,
        doador: {
          id: true,
          name: true,
        },
      },
      order: {
        updatedAt: 'DESC',
        id: 'DESC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: reviews.map((review) => ({
        id: review.id,
        nota: review.nota,
        comentario: review.comentario,
        author: {
          name: review.doador.name,
        },
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteMyReview(ongId: number, doadorId: number): Promise<ReviewResult> {
    return this.userRepository.manager.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const reviewsRepository = manager.getRepository(Reviews);

      const ong = await userRepository.findOne({
        where: {
          id: ongId,
          type: UserType.ONG,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!ong) {
        throw new NotFoundException('ONG não encontrada.');
      }

      if (ong.status !== UserStatus.ATIVO) {
        throw new ForbiddenException('Esta ONG não está ativa.');
      }

      const doador = await userRepository.findOne({
        where: {
          id: doadorId,
          type: UserType.DOADOR,
          status: UserStatus.ATIVO,
        },
        select: ['id'],
      });

      if (!doador) {
        throw new ForbiddenException(
          'Somente doadores ativos podem excluir sua avaliação.',
        );
      }

      const review = await reviewsRepository.findOne({
        where: {
          ong: { id: ongId },
          doador: { id: doadorId },
        },
        select: ['id'],
      });

      if (!review) {
        throw new NotFoundException(
          'Você não possui uma avaliação para esta ONG.',
        );
      }

      await reviewsRepository.delete(review.id);

      const remainingReviews = await reviewsRepository.find({
        where: { ong: { id: ongId } },
        select: ['id', 'nota'],
      });

      const totalReviews = remainingReviews.length;
      const sum = remainingReviews.reduce(
        (total, item) => total + item.nota,
        0,
      );

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
}
