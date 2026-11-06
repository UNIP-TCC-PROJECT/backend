import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { UserType } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

class MfaCodeDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: any) {
    await this.auth.logout(req.user.sid, req.user);
  }

  @Post('logout-all')
  logoutAll(@Req() req: any) {
    return this.auth.revokeAllForUser(req.user.id, req.user);
  }

  // Alcançáveis sem MFA verificado: são o caminho de enrolamento do administrador.
  @Post('mfa/setup')
  mfaSetup(@Req() req: any) {
    return this.auth.mfaSetup(req.user.id);
  }

  @Post('mfa/enable')
  mfaEnable(@Req() req: any, @Body() dto: MfaCodeDto) {
    return this.auth.mfaEnable(req.user.id, req.user.sid, dto.code);
  }

  @Post('admin/users/:id/revoke-sessions')
  @Roles(UserType.ADMIN)
  @UseGuards(RolesGuard)
  revoke(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.auth.revokeAllForUser(id, req.user);
  }
}
