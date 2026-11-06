import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { OngGuard } from '../auth/ong.guard';
import { fileResponse, singleFileUpload } from '../common/file-upload';
import { actorOf } from '../common/request-context';
import { UserType } from '../users/entities/user.entity';
import { OrganizationStatus } from './entities/organization.entity';
import {
  ReasonDto,
  RequestDocumentsDto,
  ReviewDto,
  UpdateOrganizationDto,
  UploadDocumentDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations/public')
export class PublicOrganizationsController {
  constructor(private svc: OrganizationsService) {}

  @Get()
  list() {
    return this.svc.listPublic();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPublic(id);
  }
}

@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private svc: OrganizationsService) {}

  @Get('me')
  @Roles(UserType.ONG)
  me(@Req() req: any) {
    return this.svc.checksStatus(req.user.id);
  }

  @Patch('me')
  @Roles(UserType.ONG)
  @UseGuards(OngGuard)
  update(@Req() req: any, @Body() dto: UpdateOrganizationDto) {
    return this.svc.updateMine(actorOf(req), dto, req.ip);
  }

  @Post('me/submit')
  @Roles(UserType.ONG)
  @UseGuards(OngGuard)
  submit(@Req() req: any) {
    return this.svc.submit(actorOf(req), req.ip);
  }

  @Get('me/documents')
  @Roles(UserType.ONG)
  documents(@Req() req: any) {
    return this.svc.listDocumentsMine(req.user.id);
  }

  @Post('me/documents')
  @Roles(UserType.ONG)
  @UseGuards(OngGuard)
  @UseInterceptors(FileInterceptor('file', singleFileUpload))
  upload(
    @Req() req: any,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.svc.uploadDocument(actorOf(req), dto, file, req.ip);
  }

  // ONG dona do documento ou administrador.
  @Get('documents/:id/file')
  @Roles(UserType.ONG, UserType.ADMIN)
  async download(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: any,
  ) {
    return fileResponse(res, await this.svc.getDocumentFile(actorOf(req), id));
  }
}

@Controller('admin/organizations')
@Roles(UserType.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminOrganizationsController {
  constructor(private svc: OrganizationsService) {}

  @Get()
  list(@Query('status') status?: OrganizationStatus) {
    return this.svc.listAll(
      status && Object.values(OrganizationStatus).includes(status)
        ? status
        : undefined,
    );
  }

  @Get('integrations')
  integrations() {
    return this.svc.integrations();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getForAdmin(id);
  }

  @Post(':id/decision')
  decide(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.svc.decide(actorOf(req), id, dto, req.ip);
  }

  @Post(':id/suspend')
  suspend(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.svc.suspend(actorOf(req), id, dto.reason, req.ip);
  }

  @Post(':id/request-documents')
  requestDocuments(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestDocumentsDto,
  ) {
    return this.svc.requestDocuments(actorOf(req), id, dto, req.ip);
  }

  @Post(':id/checks/run')
  runChecks(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.rerunChecks(actorOf(req), id, req.ip);
  }

  @Post('documents/:docId/review')
  review(
    @Req() req: any,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: ReviewDto,
  ) {
    return this.svc.reviewDocument(actorOf(req), docId, dto, req.ip);
  }
}
