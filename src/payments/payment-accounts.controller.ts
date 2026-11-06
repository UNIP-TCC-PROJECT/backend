import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsNumber, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { actorOf } from '../common/request-context';
import { UserType } from '../users/entities/user.entity';
import { PaymentAccountsService } from './payment-accounts.service';

export class ProvisionPaymentAccountDto {
  /** Faturamento mensal estimado da ONG (exigido pelo Asaas no cadastro da subconta). */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100_000_000)
  incomeValue!: number;
}

/** A ONG só vê a própria situação (a organização vem do token, nunca da URL). */
@Controller('payment-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentAccountsController {
  constructor(private svc: PaymentAccountsService) {}

  @Get('me')
  @Roles(UserType.ONG)
  me(@Req() req: any) {
    return this.svc.getMine(req.user.id);
  }
}

@Controller('admin/payment-accounts')
@Roles(UserType.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminPaymentAccountsController {
  constructor(private svc: PaymentAccountsService) {}

  @Get(':organizationId')
  get(@Param('organizationId', ParseUUIDPipe) id: string) {
    return this.svc.getForAdmin(id);
  }

  @Post(':organizationId')
  provision(@Req() req: any, @Param('organizationId', ParseUUIDPipe) id: string, @Body() dto: ProvisionPaymentAccountDto) {
    return this.svc.provision(actorOf(req), id, dto.incomeValue, req.ip);
  }

  @Post(':organizationId/refresh')
  refresh(@Req() req: any, @Param('organizationId', ParseUUIDPipe) id: string) {
    return this.svc.refresh(actorOf(req), id, req.ip);
  }

  @Post(':organizationId/sandbox-approve')
  sandboxApprove(@Req() req: any, @Param('organizationId', ParseUUIDPipe) id: string) {
    return this.svc.approveInSandbox(actorOf(req), id, req.ip);
  }
}
