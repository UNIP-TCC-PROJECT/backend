import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserType } from '../users/entities/user.entity';
import { EnviarMensagemDto } from '../conversas/dto/enviar-mensagem.dto';
import { SacService } from './sac.service';
import type { UsuarioSac } from './sac.service';

@Controller('sac/conversas')
@Roles(UserType.DOADOR, UserType.ONG, UserType.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class SacController {
  constructor(private readonly sac: SacService) {}

  @Post()
  iniciar(@Req() req: { user: UsuarioSac }) {
    return this.sac.iniciar(req.user);
  }

  @Get()
  listar(@Req() req: { user: UsuarioSac }) {
    return this.sac.listar(req.user);
  }

  @Get(':id/mensagens')
  mensagens(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: UsuarioSac },
  ) {
    return this.sac.listarMensagens(id, req.user);
  }

  @Post(':id/mensagens')
  enviar(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: UsuarioSac },
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: EnviarMensagemDto,
  ) {
    return this.sac.enviar(id, req.user, dto.texto);
  }
}
