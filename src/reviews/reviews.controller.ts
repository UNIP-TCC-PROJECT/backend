import { Controller, Post, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller('users/:ongId/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  async create(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Body('doadorId') doadorId: number, // TEMPORÁRIO: sem JWT ainda, o frontend manda o id na mão
    @Body('nota') nota: number,
  ) {
    return this.reviewsService.review(ongId, doadorId, nota);
  }
}