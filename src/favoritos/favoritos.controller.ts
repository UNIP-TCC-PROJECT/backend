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
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserType } from '../users/entities/user.entity';
import { FavoritosService } from './favoritos.service';

@Controller('favoritos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserType.DOADOR)
export class FavoritosController {
  constructor(private readonly favoritosService: FavoritosService) {}

  @Get()
  listar(@Req() request: { user: { id: number } }) {
    return this.favoritosService.listar(request.user.id);
  }

  @Get(':ongId/status')
  verificar(
    @Req() request: { user: { id: number } },
    @Param('ongId', ParseIntPipe) ongId: number,
  ) {
    return this.favoritosService.verificar(request.user.id, ongId);
  }

  @Post(':ongId')
  adicionar(
    @Req() request: { user: { id: number } },
    @Param('ongId', ParseIntPipe) ongId: number,
  ) {
    return this.favoritosService.adicionar(request.user.id, ongId);
  }

  @Delete(':ongId')
  remover(
    @Req() request: { user: { id: number } },
    @Param('ongId', ParseIntPipe) ongId: number,
  ) {
    return this.favoritosService.remover(request.user.id, ongId);
  }
}