import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Query,
  ValidationPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { PublicacoesService } from './publicacoes.service';
import { PublicacoesQueryDto } from './dto/publicacoes-query.dto';
import { CreatePublicacaoDto } from './dto/create-publicacao.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';

@Controller('publicacoes')
export class PublicacoesController {
  constructor(private readonly publicacoesService: PublicacoesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, OngGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: {
        fileSize: 2 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 8 * 1024,
      },
    }),
  )
  create(
    @Req() request: { user: { id: number } },
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: CreatePublicacaoDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.publicacoesService.create(request.user.id, dto, image);
  }

  @Get()
  findAll(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: PublicacoesQueryDto,
  ) {
    return this.publicacoesService.findAll(query);
  }

  @Get('ong/:ongId')
  findByOng(
    @Param('ongId', ParseIntPipe) ongId: number,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: PublicacoesQueryDto,
  ) {
    return this.publicacoesService.findByOng(ongId, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.publicacoesService.findOne(id);
  }
}
