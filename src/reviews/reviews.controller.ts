import {
  Controller,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReviewsService } from './reviews.service';

@Controller('users/:ongId/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Body('nota') nota: number,
    @Req() req: any,
  ) {
    const doadorId = req.user.id;
    return this.reviewsService.review(ongId, doadorId, nota);
  }
}