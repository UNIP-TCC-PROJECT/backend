import {
  Controller,
  Get,
  GoneException,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UserStatus, UserType } from '../users/entities/user.entity';
import { MedalhaBrancaService } from './medalha-branca.service';

const PROGRAMA_ENCERRADO =
  'O programa da Medalha Branca foi encerrado. A validação institucional agora é feita pelos documentos da instituição.';

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

  // Programa encerrado: novos pedidos e análises não são mais aceitos (o histórico segue consultável).
  @Post('minha')
  @UseGuards(OngGuard)
  solicitar() {
    throw new GoneException(PROGRAMA_ENCERRADO);
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
  analisar() {
    throw new GoneException(PROGRAMA_ENCERRADO);
  }
}
