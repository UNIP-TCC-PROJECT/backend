import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
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
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DonationsController {
  constructor(private svc: DonationsService) {}

  @Post('campaigns/:id/donations')
  @Roles(UserType.DOADOR)
  create(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDonationDto) {
    return this.svc.create(actorOf(req), id, dto.amountCents, req.ip);
  }

  @Get('my/donations')
  @Roles(UserType.DOADOR)
  mine(@Req() req: any) {
    return this.svc.listMine(req.user.id);
  }

  @Get('my/organization/donations')
  @Roles(UserType.ONG) @UseGuards(OngGuard)
  forOrg(@Req() req: any) {
    return this.svc.listForOrganization(req.user.id);
  }

  @Post('admin/donations/:id/confirm')
  @Roles(UserType.ADMIN)
  confirm(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setStatus(actorOf(req), id, DonationStatus.CONFIRMADA, req.ip);
  }

  @Post('admin/donations/:id/cancel')
  @Roles(UserType.ADMIN)
  cancel(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setStatus(actorOf(req), id, DonationStatus.CANCELADA, req.ip);
  }
}
