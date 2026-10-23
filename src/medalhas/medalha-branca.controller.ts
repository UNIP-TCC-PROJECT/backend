import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UserStatus, UserType } from '../users/entities/user.entity';
import { MedalhaBrancaService } from './medalha-branca.service';
import { AnalisarMedalhaBrancaDto } from './dto/analisar-medalha-branca.dto';
import { documentosUpload, MAX_DOCUMENTOS } from './medalha-branca.upload';

type AuthRequest = { user: { id: number; type: UserType; status: UserStatus } };

@Controller('medalha-branca')
@UseGuards(JwtAuthGuard)
export class MedalhaBrancaController {
  constructor(private readonly service: MedalhaBrancaService) {}

  @Get('minha')
  @UseGuards(OngGuard)
  minha(@Request() req: AuthRequest) {
    return this.service.listar(req.user.id);
  }

  @Post('minha')
  @UseGuards(OngGuard)
  @UseInterceptors(
    FilesInterceptor('documentos', MAX_DOCUMENTOS, documentosUpload),
  )
  solicitar(
    @Request() req: AuthRequest,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.service.solicitar(req.user.id, files);
  }

  @Get('documentos/:id')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async documento(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthRequest,
  ) {
    const doc = await this.service.documento(id, req.user);
    const nome = encodeURIComponent(doc.nome).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16)}`,
    );
    return new StreamableFile(doc.conteudo, {
      type: 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${nome}`,
      length: doc.tamanho,
    });
  }

  @Get('admin/ongs/:ongId')
  @UseGuards(AdminGuard)
  listar(@Param('ongId', ParseIntPipe) ongId: number) {
    return this.service.listar(ongId);
  }

  @Patch('admin/:id')
  @UseGuards(AdminGuard)
  analisar(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthRequest,
    @Body() dto: AnalisarMedalhaBrancaDto,
  ) {
    return this.service.analisar(id, req.user.id, dto);
  }
}
