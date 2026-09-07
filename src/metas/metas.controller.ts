import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';

import { MetasService } from './metas.service';
import { CreateMetaDto } from './dto/create-meta.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';

@Controller('metas')
export class MetasController {
  constructor(private readonly metasService: MetasService) {}

  @Post()
  @UseGuards(JwtAuthGuard, OngGuard)
  create(
    @Request() req: any,
    @Body() data: CreateMetaDto,
  ) {
    return this.metasService.create(req.user.id, data);
  }

  @Get('ong/:id')
  findByOng(@Param('id', ParseIntPipe) id: number) {
    return this.metasService.findByOng(id);
  }
}

