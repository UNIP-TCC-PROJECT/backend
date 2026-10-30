import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { fileResponse, singleFileUpload } from '../common/file-upload';
import { actorOf } from '../common/request-context';
import { ReviewDto } from '../organizations/organizations.dto';
import { UserType } from '../users/entities/user.entity';
import { AccountabilityService } from './accountability.service';
import { CreateDeliveryDto, CreateExpenseDto } from './accountability.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountabilityController {
  constructor(private svc: AccountabilityService) {}

  // ----- ONG -----
  @Post('my/expenses') @Roles(UserType.ONG) @UseGuards(OngGuard)
  createExpense(@Req() req: any, @Body() dto: CreateExpenseDto) {
    return this.svc.createExpense(actorOf(req), dto, req.ip);
  }

  @Get('my/expenses') @Roles(UserType.ONG) @UseGuards(OngGuard)
  expenses(@Req() req: any) {
    return this.svc.listExpensesMine(req.user.id);
  }

  @Post('my/expenses/:id/documents') @Roles(UserType.ONG) @UseGuards(OngGuard)
  @UseInterceptors(FileInterceptor('file', singleFileUpload))
  uploadExpenseDoc(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.uploadExpenseDocument(actorOf(req), id, file, req.ip);
  }

  @Post('my/deliveries') @Roles(UserType.ONG) @UseGuards(OngGuard)
  createDelivery(@Req() req: any, @Body() dto: CreateDeliveryDto) {
    return this.svc.createDelivery(actorOf(req), dto, req.ip);
  }

  @Get('my/deliveries') @Roles(UserType.ONG) @UseGuards(OngGuard)
  deliveries(@Req() req: any) {
    return this.svc.listDeliveriesMine(req.user.id);
  }

  @Post('my/deliveries/:id/evidences') @Roles(UserType.ONG) @UseGuards(OngGuard)
  @UseInterceptors(FileInterceptor('file', singleFileUpload))
  uploadEvidence(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.uploadEvidence(actorOf(req), id, file, req.ip);
  }

  // ----- ONG (dona) ou ADMIN -----
  @Get('expenses/:id/documents') @Roles(UserType.ONG, UserType.ADMIN)
  expenseDocs(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listExpenseDocuments(actorOf(req), id);
  }

  @Get('expense-documents/:id/file') @Roles(UserType.ONG, UserType.ADMIN)
  async expenseDocFile(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) {
    return fileResponse(res, await this.svc.expenseDocumentFile(actorOf(req), id));
  }

  @Get('delivery-evidences/:id/file') @Roles(UserType.ONG, UserType.ADMIN)
  async evidenceFile(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: any) {
    return fileResponse(res, await this.svc.evidenceFile(actorOf(req), id));
  }

  // ----- ADMIN -----
  @Get('admin/expenses/pending') @Roles(UserType.ADMIN)
  pendingExpenses() {
    return this.svc.listPendingExpenses();
  }

  @Post('admin/expenses/:id/review') @Roles(UserType.ADMIN)
  reviewExpense(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.svc.reviewExpense(actorOf(req), id, dto, req.ip);
  }

  @Post('admin/expense-documents/:id/review') @Roles(UserType.ADMIN)
  reviewExpenseDoc(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.svc.reviewExpenseDocument(actorOf(req), id, dto, req.ip);
  }

  @Get('admin/delivery-evidences/pending') @Roles(UserType.ADMIN)
  pendingEvidences() {
    return this.svc.listPendingEvidences();
  }

  @Post('admin/delivery-evidences/:id/review') @Roles(UserType.ADMIN)
  reviewEvidence(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.svc.reviewEvidence(actorOf(req), id, dto, req.ip);
  }
}
