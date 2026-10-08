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

@Controller('metas')
export class MetasController {
  constructor(private readonly metasService: MetasService) {}

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  findMine(@Request() req: any) {
    return this.metasService.findMine(req.user.id);
  }

  @Get('ong/:id')
  @UseGuards(JwtAuthGuard)
  findByOng(@Param('id', ParseIntPipe) id: number) {
    return this.metasService.findByOng(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.metasService.findOne(id);
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
}