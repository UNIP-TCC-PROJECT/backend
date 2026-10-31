import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { fileResponse, singleFileUpload } from '../common/file-upload';
import { actorOf } from '../common/request-context';
import { UserType } from '../users/entities/user.entity';
import { AccountabilityService } from './accountability.service';
import { CreateDeliveryDto, CreateExpenseDto, ReviewActionDto, UpdateEvidenceDto, UpdateExpenseDto, UploadEvidenceDto, UploadExpenseDocumentDto } from './accountability.dto';
import { TransparencyService } from './transparency.service';

// 8 campos de formulário (kind, description, takenAt, ids…) além do arquivo.
const evidenceUpload = { ...singleFileUpload, storage: memoryStorage(), limits: { ...singleFileUpload.limits, fields: 8 } };

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountabilityController {
  constructor(private svc: AccountabilityService) {}

  // ----- ONG -----
  @Get('my/accountability/summary') @Roles(UserType.ONG) @UseGuards(OngGuard)
  summary(@Req() req: any) { return this.svc.summaryMine(req.user.id); }

  @Post('my/expenses') @Roles(UserType.ONG) @UseGuards(OngGuard)
  createExpense(@Req() req: any, @Body() dto: CreateExpenseDto) { return this.svc.createExpense(actorOf(req), dto, req.ip); }

  @Get('my/expenses') @Roles(UserType.ONG) @UseGuards(OngGuard)
  expenses(@Req() req: any) { return this.svc.listExpensesMine(req.user.id); }

  @Patch('my/expenses/:id') @Roles(UserType.ONG) @UseGuards(OngGuard)
  updateExpense(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) { return this.svc.updateExpense(actorOf(req), id, dto, req.ip); }

  @Post('my/expenses/:id/resubmit') @Roles(UserType.ONG) @UseGuards(OngGuard)
  resubmit(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.resubmitExpense(actorOf(req), id, req.ip); }

  @Post('my/expenses/:id/documents') @Roles(UserType.ONG) @UseGuards(OngGuard)
  @UseInterceptors(FileInterceptor('file', singleFileUpload))
  uploadExpenseDoc(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadExpenseDocumentDto, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.uploadExpenseDocument(actorOf(req), id, dto, file, req.ip);
  }

  @Post('my/deliveries') @Roles(UserType.ONG) @UseGuards(OngGuard)
  createDelivery(@Req() req: any, @Body() dto: CreateDeliveryDto) { return this.svc.createDelivery(actorOf(req), dto, req.ip); }

  @Get('my/deliveries') @Roles(UserType.ONG) @UseGuards(OngGuard)
  deliveries(@Req() req: any) { return this.svc.listDeliveriesMine(req.user.id); }

  @Post('my/evidences') @Roles(UserType.ONG) @UseGuards(OngGuard)
  @UseInterceptors(FileInterceptor('file', evidenceUpload))
  uploadEvidence(@Req() req: any, @Body() dto: UploadEvidenceDto, @UploadedFile() file?: Express.Multer.File) { return this.svc.uploadEvidence(actorOf(req), dto, file, req.ip); }

  @Get('my/evidences') @Roles(UserType.ONG) @UseGuards(OngGuard)
  evidences(@Req() req: any) { return this.svc.listEvidencesMine(req.user.id); }

  @Patch('my/evidences/:id') @Roles(UserType.ONG) @UseGuards(OngGuard)
  updateEvidence(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEvidenceDto) { return this.svc.updateEvidence(actorOf(req), id, dto, req.ip); }

  // ----- ONG (dona) ou ADMIN -----
  @Get('expenses/:id/documents') @Roles(UserType.ONG, UserType.ADMIN)
  expenseDocs(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.listExpenseDocuments(actorOf(req), id); }

  @Get('expense-documents/:id/file') @Roles(UserType.ONG, UserType.ADMIN)
  async expenseDocFile(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) { return fileResponse(res, await this.svc.expenseDocumentFile(actorOf(req), id)); }

  @Get('evidences/:id/file') @Roles(UserType.ONG, UserType.ADMIN)
  async evidenceFile(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) { return fileResponse(res, await this.svc.evidenceFile(actorOf(req), id)); }

  // ----- ADMIN -----
  @Get('admin/accountability/queue') @Roles(UserType.ADMIN)
  queue() { return this.svc.queue(); }

  @Get('admin/expenses/:id') @Roles(UserType.ADMIN)
  expenseDetail(@Param('id', ParseUUIDPipe) id: string) { return this.svc.expenseDetail(id); }

  @Post('admin/expenses/:id/review') @Roles(UserType.ADMIN)
  reviewExpense(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewActionDto) { return this.svc.reviewExpense(actorOf(req), id, dto, req.ip); }

  @Post('admin/expense-documents/:id/review') @Roles(UserType.ADMIN)
  reviewExpenseDoc(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewActionDto) { return this.svc.reviewExpenseDocument(actorOf(req), id, dto, req.ip); }

  @Get('admin/evidences/:id') @Roles(UserType.ADMIN)
  evidenceDetail(@Param('id', ParseUUIDPipe) id: string) { return this.svc.evidenceDetail(id); }

  @Post('admin/evidences/:id/review') @Roles(UserType.ADMIN)
  reviewEvidence(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewActionDto) { return this.svc.reviewEvidence(actorOf(req), id, dto, req.ip); }
}

// Público (sem login): somente o que foi aprovado e marcado como publicável.
@Controller('transparency')
export class TransparencyController {
  constructor(private svc: TransparencyService) {}

  @Get('organizations/:id')
  profile(@Param('id', ParseUUIDPipe) id: string) { return this.svc.profile(id); }

  @Get('organizations/:id/ledger')
  ledger(@Param('id', ParseUUIDPipe) id: string) { return this.svc.ledger(id); }

  @Get('by-owner/:userId')
  byOwner(@Param('userId', ParseIntPipe) userId: number) { return this.svc.byOwner(userId); }

  @Get('publications/:id/accountability')
  publicationAccountability(@Param('id', ParseIntPipe) id: number) { return this.svc.publicationAccountability(id); }

  @Get('expense-documents/:id/file')
  async doc(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) {
    const f = await this.svc.publicExpenseDocument(id);
    return fileResponse(res, f, 'public, max-age=60');
  }

  @Get('evidences/:id/file')
  async evidence(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) {
    return fileResponse(res, await this.svc.publicEvidence(id), 'public, max-age=60');
  }
}
