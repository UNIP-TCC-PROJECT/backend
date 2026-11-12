import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Session } from '../auth/entities/session.entity';
import type { RequestUser } from '../common/request-context';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { ModerateOngDto, OngModerationAction } from './dto/moderate-ong.dto';

@Injectable()
export class OngModerationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async moderate(actor: RequestUser, id: number, dto: ModerateOngDto, ip?: string) {
    return this.moderateAccount(actor, id, dto, UserType.ONG, ip);
  }

  async moderateDonor(actor: RequestUser, id: number, dto: ModerateOngDto, ip?: string) {
    return this.moderateAccount(actor, id, dto, UserType.DOADOR, ip);
  }

  private async moderateAccount(
    actor: RequestUser,
    id: number,
    dto: ModerateOngDto,
    type: UserType.ONG | UserType.DOADOR,
    ip?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const account = await manager.findOne(User, {
        where: { id, type },
        select: { id: true, status: true, contentRestricted: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) throw new NotFoundException(type === UserType.ONG ? 'ONG não encontrada.' : 'Doador não encontrado.');

      const before = { status: account.status, contentRestricted: account.contentRestricted };
      const after = { ...before };
      switch (dto.action) {
        case OngModerationAction.RESTRINGIR:
        case OngModerationAction.REMOVER_RESTRICAO:
          if (before.status !== UserStatus.ATIVO) {
            throw new ConflictException('Reative a conta antes de alterar a restrição de conteúdo.');
          }
          after.contentRestricted = dto.action === OngModerationAction.RESTRINGIR;
          break;
        case OngModerationAction.SUSPENDER:
          if (before.status === UserStatus.BANIDO) {
            throw new ConflictException('A conta já está banida.');
          }
          after.status = UserStatus.SUSPENSO;
          break;
        case OngModerationAction.BANIR:
          after.status = UserStatus.BANIDO;
          break;
        case OngModerationAction.REATIVAR:
          after.status = UserStatus.ATIVO;
          break;
      }

      if (after.status === before.status && after.contentRestricted === before.contentRestricted) {
        return { id, ...after };
      }

      await manager.update(User, id, after);
      if (after.status !== UserStatus.ATIVO) {
        await manager.update(Session, { userId: id, revokedAt: IsNull() }, { revokedAt: new Date() });
      }
      await this.audit.log({
        actor,
        action: type === UserType.ONG ? 'ONG_ACCOUNT_MODERATED' : 'DONOR_ACCOUNT_MODERATED',
        entityType: 'user',
        entityId: id,
        metadata: { action: dto.action, reason: dto.reason, before, after },
        ip,
      }, manager);
      return { id, ...after };
    });
  }
}
