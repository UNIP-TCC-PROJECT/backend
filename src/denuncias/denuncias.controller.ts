import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DenunciasService } from './denuncias.service';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';

@Controller('denuncias')
export class DenunciasController {
  constructor(private readonly denunciasService: DenunciasService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateDenunciaDto, @Req() req: any) {
    return this.denunciasService.create(req.user.id, dto);
  }
}
