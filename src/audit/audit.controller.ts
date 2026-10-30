import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserType } from '../users/entities/user.entity';
import { AuditService } from './audit.service';

// Somente leitura: não existe rota de escrita, edição ou remoção de logs.
@Controller('admin/audit-logs')
@Roles(UserType.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(
    @Query('entityType') entityType?: string,
    @Query('organizationId') organizationId?: string,
    @Query('actorId') actorId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.list({
      entityType,
      organizationId,
      actorId: actorId ? Number(actorId) || undefined : undefined,
      limit: limit ? Number(limit) || undefined : undefined,
    });
  }
}
