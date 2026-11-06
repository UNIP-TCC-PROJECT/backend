import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { UserStatus, UserType } from '../users/entities/user.entity';
import { AuthService, MAX_FAILED_LOGINS } from './auth.service';
import { sealSecret, totpAt } from './totp';

describe('AuthService.login', () => {
  const hash = bcrypt.hashSync('Senha@123', 4);
  let user: any;
  const users = {
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => ({ addSelect: () => ({ where: () => ({ getOne: async () => user }) }) })),
  };
  const sessions = { create: jest.fn((x) => x), save: jest.fn(async (x) => ({ ...x, id: 'sid-1' })) };
  const jwt = { signAsync: jest.fn(async () => 'token') };
  const audit = { log: jest.fn() };
  const svc = new AuthService(users as any, sessions as any, jwt as any, audit as any);
  const meta = { ip: '1.1.1.1' };

  beforeAll(() => (process.env.JWT_SECRET = 'test-secret'));
  beforeEach(() => {
    jest.clearAllMocks();
    user = { id: 1, email: 'a@a.com', password: hash, type: UserType.DOADOR, status: UserStatus.ATIVO, failedLoginAttempts: 0, lockedUntil: null, mfaEnabled: false };
  });

  it('autentica e cria sessão revogável', async () => {
    await expect(svc.login('a@a.com', 'Senha@123', undefined, meta)).resolves.toMatchObject({ access_token: 'token', mfa_setup_required: false });
    expect(sessions.save).toHaveBeenCalled();
  });

  it('rejeita conta inativa mesmo com senha correta', async () => {
    user.status = UserStatus.SUSPENSO;
    await expect(svc.login('a@a.com', 'Senha@123', undefined, meta)).rejects.toThrow(ForbiddenException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('bloqueia a conta após tentativas excessivas', async () => {
    user.failedLoginAttempts = MAX_FAILED_LOGINS - 1;
    await expect(svc.login('a@a.com', 'errada', undefined, meta)).rejects.toThrow(UnauthorizedException);
    expect(users.update).toHaveBeenCalledWith(1, expect.objectContaining({ lockedUntil: expect.any(Date) }));
  });

  it('recusa conta bloqueada mesmo com a senha correta', async () => {
    user.lockedUntil = new Date(Date.now() + 60_000);
    await expect(svc.login('a@a.com', 'Senha@123', undefined, meta)).rejects.toThrow(ForbiddenException);
    expect(sessions.save).not.toHaveBeenCalled();
  });

  it('não revela se o e-mail existe', async () => {
    user = null;
    await expect(svc.login('x@x.com', 'qualquer', undefined, meta)).rejects.toThrow('Email ou senha inválidos');
  });

  describe('administrador', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    beforeEach(() => {
      user = { ...user, type: UserType.ADMIN };
    });

    it('sem MFA configurado: sessão sem mfaVerified e exige enrolamento', async () => {
      const r = await svc.login('a@a.com', 'Senha@123', undefined, meta);
      expect(r.mfa_setup_required).toBe(true);
      expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ mfaVerified: false }));
    });

    it('com MFA ativo: exige o código e rejeita código inválido', async () => {
      user.mfaEnabled = true;
      user.mfaSecret = sealSecret(secret);
      await expect(svc.login('a@a.com', 'Senha@123', undefined, meta)).rejects.toMatchObject({ response: { mfaRequired: true } });
      await expect(svc.login('a@a.com', 'Senha@123', '000000', meta)).rejects.toThrow(UnauthorizedException);
      const r = await svc.login('a@a.com', 'Senha@123', totpAt(secret, Date.now()), meta);
      expect(r.mfa_setup_required).toBe(false);
      expect(sessions.save).toHaveBeenLastCalledWith(expect.objectContaining({ mfaVerified: true }));
    });
  });
});
