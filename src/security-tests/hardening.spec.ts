import { validate } from 'class-validator';
import { corsOrigin } from '../app.setup';
import { chainHash } from '../audit/audit.service';
import { detectImage } from '../common/file-upload';
import { IsStrongPassword } from '../common/password';
import { sanitizeUser } from '../users/users.service';

class Dto { @IsStrongPassword() password!: string; }
const pwOk = async (p: unknown) => (await validate(Object.assign(new Dto(), { password: p }))).length === 0;
const allows = (env: NodeJS.ProcessEnv, origin?: string) => { let r: boolean | undefined; corsOrigin(env)(origin, (_e, ok) => (r = ok)); return r; };

describe('política de senha', () => {
  it.each(['123', '12345', 'abc123', '1234567', '12345678', 'password', 'aaaaaaaaaa', 'Senha123', 'x'.repeat(73)])('rejeita %s', async (p) => {
    expect(await pwOk(p)).toBe(false); // curta, comum (inclui "Senha123"), repetitiva ou longa demais
  });
  it('aceita frase longa e rejeita não-string', async () => {
    expect(await pwOk('cavalo-bateria-grampo-2026')).toBe(true);
    expect(await pwOk(12345678)).toBe(false);
  });
});

describe('CORS', () => {
  it('nunca reflete origem arbitrária', () => {
    expect(allows({ NODE_ENV: 'production' }, 'https://evil.example')).toBe(false);
    expect(allows({ NODE_ENV: 'development' }, 'https://evil.example')).toBe(false);
    expect(allows({ NODE_ENV: 'development' }, 'http://localhost:5173')).toBe(true);
    expect(allows({ NODE_ENV: 'production' }, 'http://localhost:5173')).toBe(false);
  });
  it('com CORS_ORIGINS, só a lista (e requisições sem Origin)', () => {
    const env = { NODE_ENV: 'production', CORS_ORIGINS: 'https://app.exemplo.org, https://x.org' };
    expect(allows(env, 'https://app.exemplo.org')).toBe(true);
    expect(allows(env, 'https://app.exemplo.org.evil.com')).toBe(false);
    expect(allows(env, undefined)).toBe(true);
  });
});

describe('detectImage', () => {
  it('reconhece pelos bytes e ignora conteúdo ativo', () => {
    expect(detectImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]))?.ext).toBe('jpg');
    expect(detectImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]))?.ext).toBe('webp');
    for (const b of ['<svg onload=alert(1)/>', '<html></html>', 'GIF89a............', '%PDF-1.4 ......']) expect(detectImage(Buffer.from(b))).toBeNull();
  });
});

describe('cadeia de hash da auditoria', () => {
  const row = { actorId: 1, actorType: 'ADMIN', action: 'X', entityType: 'e', entityId: '1', organizationId: null, metadata: { b: 1, a: { d: 2, c: 3 } }, ip: null, createdAt: new Date('2026-01-01T00:00:00.000Z') };
  it('é determinística e independe da ordem das chaves do jsonb', () => {
    expect(chainHash('0'.repeat(64), row)).toBe(chainHash('0'.repeat(64), { ...row, metadata: { a: { c: 3, d: 2 }, b: 1 } }));
  });
  it('muda se qualquer campo ou o elo anterior mudar', () => {
    const h = chainHash('0'.repeat(64), row);
    expect(chainHash('1'.repeat(64), row)).not.toBe(h);
    expect(chainHash('0'.repeat(64), { ...row, action: 'Y' })).not.toBe(h);
    expect(chainHash('0'.repeat(64), { ...row, createdAt: new Date('2026-01-01T00:00:00.001Z') })).not.toBe(h);
  });
});

describe('sanitizeUser', () => {
  it('remove senha e campos internos', () => {
    const r = sanitizeUser({ id: 1, name: 'x', password: 'h', mfaSecret: 's', asaasCustomerId: 'c', failedLoginAttempts: 2, lockedUntil: new Date() });
    expect(Object.keys(r).sort()).toEqual(['id', 'name']);
  });
});
