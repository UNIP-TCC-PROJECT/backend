import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserStatus } from '../users/entities/user.entity';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Sessão válida não basta: conta suspensa/banida perde acesso a qualquer rota autenticada, de qualquer perfil.
  handleRequest<T = any>(err: any, user: any, info: any, context: any, status?: any): T {
    const u = super.handleRequest(err, user, info, context, status) as any;
    if (u.status !== UserStatus.ATIVO) {
      throw new ForbiddenException('Esta conta está suspensa ou banida.');
    }
    return u;
  }
}
