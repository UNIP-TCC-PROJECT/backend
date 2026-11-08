import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  ParseIntPipe,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Request,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { MetasService } from './metas.service';
import { CreateMetaDto } from './dto/create-meta.dto';
import { UpdateMetaDto } from './dto/update-meta.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserType } from '../users/entities/user.entity';
import { actorOf } from '../common/request-context';
import { ReviewContentDto } from '../common/review-content.dto';

@Controller('metas')
export class MetasController {
  constructor(private readonly metasService: MetasService) {}

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  findMine(@Request() req: any) {
    return this.metasService.findMine(req.user.id);
  }

  @Get('admin/pending-review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.ADMIN)
  pendingReview() {
    return this.metasService.listPendingReview();
  }

  @Get('ong/:id')
  findByOng(@Param('id', ParseIntPipe) id: number) {
    return this.metasService.findByOng(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.metasService.findOne(id, req.user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, OngGuard)
  @UsePipes(new ValidationPipe())
  create(
    @Request() req: any,
    @Body() data: CreateMetaDto,
  ) {
    return this.metasService.create(req.user.id, data);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe())
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateMetaDto,
    @Request() req: any,
  ) {
    return this.metasService.update(id, req.user.id, data);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.metasService.deactivate(id, req.user.id);
  }

  @Post('admin/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.ADMIN)
  review(@Request() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: ReviewContentDto) {
    return this.metasService.review(actorOf(req), id, dto.decision, dto.reason);
  }
}
