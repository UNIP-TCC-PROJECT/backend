import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { UserType, UserStatus } from '../users/entities/user.entity';

@Injectable()
export class OngGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Usuário não autenticado');
    }

    if (user.type !== UserType.ONG) {
      throw new ForbiddenException(
        'Acesso permitido somente para ONGs',
      );
    }

    if (user.status !== UserStatus.ATIVO) {
      throw new ForbiddenException(
        'A ONG está suspensa ou banida e não pode realizar esta ação',
      );
    }

    return true;
  }
}