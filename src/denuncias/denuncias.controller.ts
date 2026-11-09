import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserType } from '../users/entities/user.entity';
import { DenunciasService } from './denuncias.service';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { ReviewDenunciaDto } from './dto/review-denuncia.dto';
import { DenunciaStatus } from './entities/denuncia.entity';

@Controller('denuncias')
export class DenunciasController {
  constructor(private readonly denunciasService: DenunciasService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateDenunciaDto, @Req() req: any) {
    return this.denunciasService.create(req.user.id, dto);
  }
}

@Controller('admin/denuncias')
@Roles(UserType.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminDenunciasController {
  constructor(private readonly denunciasService: DenunciasService) {}

  @Get()
  list(@Query('status') status?: DenunciaStatus, @Query('all') all?: string) {
    const validStatus =
      status && Object.values(DenunciaStatus).includes(status) ? status : undefined;
    return this.denunciasService.listForAdmin(validStatus, all === 'true');
  }

  @Post(':id/decision')
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewDenunciaDto,
    @Req() req: any,
  ) {
    return this.denunciasService.reviewByAdmin(req.user.id, id, dto, req.ip);
  }
}
