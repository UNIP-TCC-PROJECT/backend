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

    return true;
  }
}