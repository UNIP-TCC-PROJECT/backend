import {
  Controller,
  Post,
  Get,
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
    @Body('comentario') comentario: string | undefined,
    @Req() req: any,
  ) {
    const doadorId = req.user.id;
    return this.reviewsService.review(ongId, doadorId, nota, comentario);
  }

  @Get()
  async list(@Param('ongId', ParseIntPipe) ongId: number) {
    return this.reviewsService.listComments(ongId);
  }

  // Avaliação do próprio doador autenticado (null se ainda não avaliou).
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async mine(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Req() req: any,
  ) {
    return this.reviewsService.findMine(ongId, req.user.id);
  }
}
