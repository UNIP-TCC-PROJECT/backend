import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (request.user?.type !== 'ADMIN') {
      throw new ForbiddenException(
        'Acesso permitido somente para administradores',
      );
    }

    if (!request.user.mfaVerified) {
      throw new ForbiddenException('MFA obrigatório para administradores');
    }

    return true;
  }
}