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
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserType } from '../users/entities/user.entity';
import { ReviewsService } from './reviews.service';

@Controller('users/:ongId/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Roles(UserType.DOADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
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