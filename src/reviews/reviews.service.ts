import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reviews } from './entities/reviews.entity';
import { User, UserType } from '../users/entities/user.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Reviews)
    private reviewsRepository: Repository<Reviews>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async review(ongId: number, doadorId: number, nota: number): Promise<User> {
    if (nota < 1 || nota > 5) {
      throw new BadRequestException('A nota deve ser entre 1 e 5.');
    }

    const ong = await this.userRepository.findOne({ where: { id: ongId } });
    if (!ong) {
      throw new NotFoundException('ONG não encontrada.');
    }
    if (ong.type !== UserType.ONG) {
      throw new BadRequestException('Esse usuário não é uma ONG.');
    }

    const doador = await this.userRepository.findOne({ where: { id: doadorId } });
    if (!doador) {
      throw new NotFoundException('Doador não encontrado.');
    }
    if (doador.type !== UserType.DOADOR) {
      throw new BadRequestException('Esse usuário não é um doador.');
    }

    const existingReview = await this.reviewsRepository.findOne({
      where: { ong: { id: ongId }, doador: { id: doadorId } },
    });

    if (existingReview) {
      existingReview.nota = nota;
      await this.reviewsRepository.save(existingReview);
    } else {
      const newReview = this.reviewsRepository.create({
        nota,
        ong,
        doador,
      });
      await this.reviewsRepository.save(newReview);
    }

    await this.updateAverage(ongId);

    const updatedOng = await this.userRepository.findOne({ where: { id: ongId } });
    if (!updatedOng) {
      throw new NotFoundException('ONG não encontrada após atualização.');
    }
    return updatedOng;
  }

  private async updateAverage(ongId: number): Promise<void> {
    const reviews = await this.reviewsRepository.find({
      where: { ong: { id: ongId } },
    });

    const total = reviews.length;
    const sum = reviews.reduce((acc, r) => acc + r.nota, 0);
    const average = total > 0 ? sum / total : 0;

    await this.userRepository.update(ongId, {
      averageRating: Number(average.toFixed(2)),
      totalReviews: total,
    });
  }
}