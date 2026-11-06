import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { Session } from './entities/session.entity';
import type { JwtPayload } from './jwt-payload.interface';
import { newTotpSecret, openSecret, otpauthUri, sealSecret, verifyTotp } from './totp';

export const BCRYPT_ROUNDS = 12;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const SESSION_HOURS = 8;

// Hash descartável: iguala o tempo de resposta quando o e-mail não existe.
const DUMMY_HASH = bcrypt.hashSync('invalid', BCRYPT_ROUNDS);
const INVALID = 'Email ou senha inválidos';

interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Session) private sessions: Repository<Session>,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  async login(email: string, password: string, otp: string | undefined, meta: ClientMeta) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.mfaSecret')
      .where('u.email = :email', { email })
      .getOne();

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({ action: 'LOGIN_BLOCKED', entityType: 'user', entityId: user.id, ip: meta.ip });
      throw new ForbiddenException('Conta temporariamente bloqueada por tentativas excessivas. Tente mais tarde.');
    }

    const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !ok) {
      if (user) await this.registerFailure(user, meta);
      throw new UnauthorizedException(INVALID);
    }
    if (user.status !== UserStatus.ATIVO) {
      throw new ForbiddenException('Esta conta não está ativa');
    }

    let mfaVerified = false;
    if (user.type === UserType.ADMIN && user.mfaEnabled && user.mfaSecret) {
      if (!otp) throw new UnauthorizedException({ message: 'Código MFA obrigatório', mfaRequired: true });
      if (!verifyTotp(openSecret(user.mfaSecret), otp)) {
        await this.registerFailure(user, meta);
        throw new UnauthorizedException({ message: 'Código MFA inválido', mfaRequired: true });
      }
      mfaVerified = true;
    }

    await this.users.update(user.id, { failedLoginAttempts: 0, lockedUntil: null });
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        mfaVerified,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000),
      }),
    );
    await this.audit.log({
      actor: { id: user.id, type: user.type },
      action: 'LOGIN',
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      type: user.type,
      status: user.status,
      sid: session.id,
    };
    return {
      access_token: await this.jwt.signAsync(payload),
      // Admin sem MFA ativo só consegue configurá-lo até concluir o enrolamento.
      mfa_setup_required: user.type === UserType.ADMIN && !mfaVerified,
    };
  }

  private async registerFailure(user: User, meta: ClientMeta) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_LOGINS;
    await this.users.update(user.id, {
      failedLoginAttempts: lock ? 0 : attempts,
      lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
    });
    await this.audit.log({
      action: lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
    });
  }

  /** Usada pela JwtStrategy: sessão válida = existe, do usuário, não revogada e não expirada. */
  findActiveSession(sid: string, userId: number) {
    return this.sessions.findOne({
      where: { id: sid, userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
  }

  async logout(sid: string, actor: { id: number; type: string }) {
    await this.sessions.update({ id: sid, userId: actor.id }, { revokedAt: new Date() });
    await this.audit.log({ actor, action: 'LOGOUT', entityType: 'session', entityId: sid });
  }

  async revokeAllForUser(userId: number, actor?: { id: number; type: string }) {
    const r = await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.audit.log({
      actor,
      action: 'SESSIONS_REVOKED',
      entityType: 'user',
      entityId: userId,
      metadata: { count: r.affected ?? 0 },
    });
    return { revoked: r.affected ?? 0 };
  }

  async mfaSetup(userId: number) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.type !== UserType.ADMIN) throw new ForbiddenException();
    if (user.mfaEnabled) throw new BadRequestException('MFA já está ativo.');
    const secret = newTotpSecret();
    await this.users.update(userId, { mfaSecret: sealSecret(secret) });
    return { secret, otpauth_url: otpauthUri(user.email, secret) };
  }

  async mfaEnable(userId: number, sid: string, code: string) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.mfaSecret')
      .where('u.id = :userId', { userId })
      .getOneOrFail();
    if (user.type !== UserType.ADMIN || user.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException('Inicie a configuração do MFA primeiro.');
    }
    if (!verifyTotp(openSecret(user.mfaSecret), code)) {
      throw new UnauthorizedException('Código MFA inválido');
    }
    await this.users.update(userId, { mfaEnabled: true });
    await this.sessions.update({ id: sid }, { mfaVerified: true });
    await this.audit.log({ actor: { id: userId, type: user.type }, action: 'MFA_ENABLED', entityType: 'user', entityId: userId });
    return { mfaEnabled: true };
  }
}
