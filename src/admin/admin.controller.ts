import { Controller, Post, Body, Get, Param, ParseIntPipe, Patch, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CreateAdminDto } from './dto/create-admin-dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserType } from '../users/entities/user.entity';
import { actorOf } from '../common/request-context';
import { ModerateOngDto } from './dto/moderate-ong.dto';
import { OngModerationService } from './ong-moderation.service';

@Controller('admin')
@Roles(UserType.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private usersService: UsersService,
    private ongModeration: OngModerationService,
  ) {}

  @Post('admins')
  @UsePipes(new ValidationPipe())
  createAdmin(@Body() createAdminDto: CreateAdminDto) {
    return this.usersService.createAdmin(createAdminDto);
  }

  @Get('ongs')
  findAllOngs() {
    return this.usersService.findAllOngs(true);
  }

  @Get('ongs/:id')
  findOngById(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOngById(id, true);
  }

  @Get('doadores')
  findAllDonors() {
    return this.usersService.findAllDonors(true);
  }

  @Get('doadores/:id')
  findDonorById(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findDonorById(id, true);
  }

  @Patch('ongs/:id/moderacao')
  moderateOng(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModerateOngDto,
    @Req() req: { user: { id: number; type: UserType }; ip?: string },
  ) {
    return this.ongModeration.moderate(actorOf(req), id, dto, req.ip);
  }

  @Patch('doadores/:id/moderacao')
  moderateDonor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModerateOngDto,
    @Req() req: { user: { id: number; type: UserType }; ip?: string },
  ) {
    return this.ongModeration.moderateDonor(actorOf(req), id, dto, req.ip);
  }
}
