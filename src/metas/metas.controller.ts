import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MetasService } from './metas.service';
import { CreateMetaDto } from './dto/create-meta.dto';
import { UpdateMetaDto } from './dto/update-meta.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('metas')
export class MetasController {
  constructor(private readonly metasService: MetasService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() createMetaDto: CreateMetaDto, @Request() req) {
    console.log('🔍 ====================');
    console.log('🔍 req.user:', req.user);
    console.log('🔍 req.user.id:', req.user?.id);
    console.log('🔍 req.user.sub:', req.user?.sub);
    console.log('🔍 ====================');
    
    const ongId = req.user?.id || req.user?.sub;
    
    if (!ongId) {
      throw new Error('ID da ONG não encontrado no token');
    }
    
    return this.metasService.create(createMetaDto, ongId);
  }

  @Get('ong/:id')
  @UseGuards(JwtAuthGuard)
  findByOng(@Param('id', ParseIntPipe) id: number) {
    return this.metasService.findByOng(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.metasService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMetaDto: UpdateMetaDto,
    @Request() req,
  ) {
    const ongId = req.user?.id || req.user?.sub;
    return this.metasService.update(id, updateMetaDto, ongId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    const ongId = req.user?.id || req.user?.sub;
    return this.metasService.remove(id, ongId);
  }
}