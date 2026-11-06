import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OngGuard } from '../auth/ong.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { actorOf } from '../common/request-context';
import { UserType } from '../users/entities/user.entity';
import { DonationsService } from './donations.service';
import { DonationStatus } from './entities/donation.entity';

class CreateDonationDto {
  @IsInt() @Min(5_00) @Max(10_000_00) amountCents!: number;
  // Necessário para emitir o Pix quando o perfil do doador não tem CPF.
  @IsOptional() @IsString() cpf?: string;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DonationsController {
  constructor(private svc: DonationsService) {}

  // ----- Doador -----
  @Post('campaigns/:id/donations') @Roles(UserType.DOADOR)
  create(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDonationDto, @Headers('idempotency-key') key?: string) {
    return this.svc.create(actorOf(req), id, dto, key, req.ip);
  }

  @Get('my/donations') @Roles(UserType.DOADOR)
  mine(@Req() req: any) { return this.svc.listMine(req.user.id); }

  @Get('my/donations/summary') @Roles(UserType.DOADOR)
  summary(@Req() req: any) { return this.svc.summaryMine(req.user.id); }

  @Get('my/donations/:id') @Roles(UserType.DOADOR)
  one(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.getMine(req.user.id, id); }

  // Pede ao servidor que confira a cobrança no Asaas; a confirmação nunca vem do navegador.
  @Post('my/donations/:id/sync') @Roles(UserType.DOADOR)
  sync(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.syncMine(actorOf(req), id); }

  // ----- ONG -----
  @Get('my/organization/donations') @Roles(UserType.ONG) @UseGuards(OngGuard)
  forOrg(@Req() req: any) { return this.svc.listForOrganization(req.user.id); }

  @Get('my/organization/dashboard') @Roles(UserType.ONG) @UseGuards(OngGuard)
  dashboard(@Req() req: any) { return this.svc.dashboard(req.user.id); }

  @Get('my/organization/financial-history') @Roles(UserType.ONG) @UseGuards(OngGuard)
  history(@Req() req: any) { return this.svc.financialHistory(req.user.id); }

  // ----- Admin: apenas leitura e reconciliação (não existe confirmação manual) -----
  @Get('admin/donations') @Roles(UserType.ADMIN)
  list(@Query('status') status?: DonationStatus) {
    return this.svc.listAdmin(status && Object.values(DonationStatus).includes(status) ? status : undefined);
  }

  @Post('admin/donations/:id/reconcile') @Roles(UserType.ADMIN)
  reconcile(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.adminReconcile(actorOf(req), id); }
}
