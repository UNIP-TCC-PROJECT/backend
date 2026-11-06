import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  ValidationPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { PublicacoesService } from './publicacoes.service';
import { PublicacoesQueryDto } from './dto/publicacoes-query.dto';
import { AttachmentDto, CreatePublicacaoDto } from './dto/create-publicacao.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserType } from '../users/entities/user.entity';
import { actorOf } from '../common/request-context';
import { fileResponse } from '../common/file-upload';
import { ReviewActionDto } from '../accountability/accountability.dto';
import { MAX_ANEXO_BYTES } from './publicacoes.constants';

const upload = FileInterceptor('image', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_ANEXO_BYTES, files: 1, fields: 8, fieldSize: 8 * 1024 },
});
const uploadAttachment = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_ANEXO_BYTES, files: 1, fields: 2, fieldSize: 1024 },
});
const pipe = new ValidationPipe({ transform: true, whitelist: true });

@Controller()
export class PublicacoesController {
  constructor(private readonly publicacoesService: PublicacoesService) {}

  // ----- ONG -----
  @Post('publicacoes')
  @UseGuards(JwtAuthGuard, OngGuard)
  @UseInterceptors(upload)
  create(@Req() req: any, @Body(pipe) dto: CreatePublicacaoDto, @UploadedFile() image?: Express.Multer.File) {
    return this.publicacoesService.create(req.user.id, dto, image, req.ip);
  }

  @Get('publicacoes/mine')
  @UseGuards(JwtAuthGuard, OngGuard)
  mine(@Req() req: any) {
    return this.publicacoesService.mine(req.user.id);
  }

  @Post('publicacoes/:id/anexos')
  @UseGuards(JwtAuthGuard, OngGuard)
  @UseInterceptors(uploadAttachment)
  addAttachment(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body(pipe) dto: AttachmentDto, @UploadedFile() file?: Express.Multer.File) {
    return this.publicacoesService.addAttachment(req.user.id, id, file, !!dto.imageConsent, req.ip);
  }

  @Get('publicacoes/mine/anexos/:id/file')
  @UseGuards(JwtAuthGuard, OngGuard)
  async ownFile(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) {
    return fileResponse(res, await this.publicacoesService.ownFile(req.user.id, id));
  }

  // ----- Público (somente ONGs aprovadas; só anexos aprovados e publicáveis) -----
  @Get('publicacoes')
  findAll(@Query(pipe) query: PublicacoesQueryDto) {
    return this.publicacoesService.findAll(query);
  }

  @Get('publicacoes/ong/:ongId')
  findByOng(@Param('ongId', ParseIntPipe) ongId: number, @Query(pipe) query: PublicacoesQueryDto) {
    return this.publicacoesService.findByOng(ongId, query);
  }

  @Get('publicacoes/anexos/:id/file')
  async publicFile(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) {
    return fileResponse(res, await this.publicacoesService.publicFile(id), 'public, max-age=300');
  }

  @Get('publicacoes/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.publicacoesService.findOne(id);
  }

  // ----- Admin: análise dos anexos -----
  @Get('admin/publication-attachments')
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserType.ADMIN)
  pending() {
    return this.publicacoesService.listPendingFiles();
  }

  @Get('admin/publication-attachments/:id/file')
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserType.ADMIN)
  async adminFile(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) {
    return fileResponse(res, await this.publicacoesService.adminFile(id));
  }

  @Post('admin/publication-attachments/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserType.ADMIN)
  review(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewActionDto) {
    return this.publicacoesService.reviewFile(actorOf(req), id, dto, req.ip);
  }
}
