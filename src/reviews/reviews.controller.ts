import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  Query,
  Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReviewsService } from './reviews.service';
import { SaveReviewDto } from './dto/save-review.dto';
import { ReviewsQueryDto } from './dto/reviews-query.dto';

@Controller('users/:ongId/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Body() data: SaveReviewDto,
    @Req() req: any,
  ) {
    const doadorId = req.user.id;

    return this.reviewsService.review(
      ongId,
      doadorId,
      data.nota,
      data.comentario,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async findMyReview(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Req() req: any,
  ) {
    const review = await this.reviewsService.findMyReview(ongId, req.user.id);

    return { review };
  }

  @Get()
  async findAllByOng(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Query() query: ReviewsQueryDto,
  ) {
    return this.reviewsService.findAllByOng(ongId, query.page, query.limit);
  }
  @UseGuards(JwtAuthGuard)
  @Delete('me')
  async deleteMyReview(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Req() req: any,
  ) {
    return this.reviewsService.deleteMyReview(ongId, req.user.id);
  }
}
