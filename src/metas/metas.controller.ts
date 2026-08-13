import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  Body,
} from '@nestjs/common';

import { MetasService } from './metas.service';
import { CreateMetaDto } from './dto/create-meta.dto';

@Controller('metas')
export class MetasController {
  constructor(private readonly metasService: MetasService) {}

  @Post()
  create(@Body() data: CreateMetaDto) {
    return this.metasService.create(data);
  }

  @Get('ong/:id')
  findByOng(@Param('id', ParseIntPipe) id: number) {
    return this.metasService.findByOng(id);
  }
}