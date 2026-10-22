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
import { OngGuard } from '../auth/ong.guard';
import { UserStatus, UserType } from '../users/entities/user.entity';
import { ConversasService } from './conversas.service';
import { EnviarMensagemDto } from './dto/enviar-mensagem.dto';

interface RequestComUsuario {
  user: {
    id: number;
    type: UserType;
    status: UserStatus;
  };
}

@Controller('conversas')
@UseGuards(JwtAuthGuard)
export class ConversasController {
  constructor(private readonly conversasService: ConversasService) {}

  @Post('ongs/:ongId')
  iniciarPorDoador(
    @Req() request: RequestComUsuario,
    @Param('ongId', ParseIntPipe) ongId: number,
  ) {
    return this.conversasService.iniciarPorDoador(request.user.id, ongId);
  }

  @Post('doadores/:doadorId')
  @UseGuards(OngGuard)
  iniciarPorOng(
    @Req() request: RequestComUsuario,
    @Param('doadorId', ParseIntPipe) doadorId: number,
  ) {
    return this.conversasService.iniciarPorOng(request.user.id, doadorId);
  }

  @Get()
  listar(@Req() request: RequestComUsuario) {
    return this.conversasService.listar(request.user);
  }

  @Get(':id/mensagens')
  listarMensagens(
    @Req() request: RequestComUsuario,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.conversasService.listarMensagens(id, request.user);
  }

  @Post(':id/mensagens')
  enviarMensagem(
    @Req() request: RequestComUsuario,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: EnviarMensagemDto,
  ) {
    return this.conversasService.enviarMensagem(id, request.user, dto.texto);
  }
}
