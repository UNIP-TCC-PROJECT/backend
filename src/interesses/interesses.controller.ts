import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserType } from '../users/entities/user.entity';
import { InteressesService } from './interesses.service';

@Controller('interesses')
export class InteressesController {
  constructor(private readonly interessesService: InteressesService) {}

  @Get('minha-ong')
  @UseGuards(JwtAuthGuard, OngGuard)
  listarDaOng(@Req() request: { user: { id: number } }) {
    return this.interessesService.listarDaOng(request.user.id);
  }

  @Get(':ongId/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.DOADOR)
  verificar(
    @Req() request: { user: { id: number } },
    @Param('ongId', ParseIntPipe) ongId: number,
  ) {
    return this.interessesService.verificar(request.user.id, ongId);
  }

  @Post(':ongId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.DOADOR)
  demonstrar(
    @Req() request: { user: { id: number } },
    @Param('ongId', ParseIntPipe) ongId: number,
  ) {
    return this.interessesService.demonstrar(request.user.id, ongId);
  }

  @Delete(':ongId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.DOADOR)
  cancelar(
    @Req() request: { user: { id: number } },
    @Param('ongId', ParseIntPipe) ongId: number,
  ) {
    return this.interessesService.cancelar(request.user.id, ongId);
  }
}
