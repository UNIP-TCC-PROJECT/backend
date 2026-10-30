import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { actorOf } from '../common/request-context';
import { ReasonDto } from '../organizations/organizations.dto';
import { UserType } from '../users/entities/user.entity';
import { CampaignStatusDto, CreateCampaignDto, UpdateCampaignDto } from './campaigns.dto';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
export class PublicCampaignsController {
  constructor(private svc: CampaignsService) {}

  @Get()
  list() {
    return this.svc.listPublic();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPublic(id);
  }
}

@Controller('my/campaigns')
@Roles(UserType.ONG)
@UseGuards(JwtAuthGuard, RolesGuard, OngGuard)
export class MyCampaignsController {
  constructor(private svc: CampaignsService) {}

  @Get()
  list(@Req() req: any) {
    return this.svc.listMine(req.user.id);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getMine(req.user.id, id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateCampaignDto) {
    return this.svc.create(actorOf(req), dto, req.ip);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto) {
    return this.svc.update(actorOf(req), id, dto, req.ip);
  }

  @Post(':id/image')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0 } }))
  image(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.setImage(actorOf(req), id, file, req.ip);
  }

  @Post(':id/status')
  status(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CampaignStatusDto) {
    return this.svc.setStatus(actorOf(req), id, dto, req.ip);
  }
}

@Controller('admin/campaigns')
@Roles(UserType.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminCampaignsController {
  constructor(private svc: CampaignsService) {}

  @Get()
  list() {
    return this.svc.listAll();
  }

  @Post(':id/suspend')
  suspend(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.svc.suspend(actorOf(req), id, dto.reason, req.ip);
  }
}
