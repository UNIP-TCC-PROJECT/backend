import { openSecret, sealSecret, totpAt, verifyTotp } from './totp';

describe('TOTP / segredo MFA', () => {
  beforeAll(() => (process.env.JWT_SECRET = 'test-secret'));

  it('gera o vetor de teste da RFC 6238 (t=59s → ...287082)', () => {
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
  });

  it('aceita ±1 passo e rejeita código antigo ou malformado', () => {
    const s = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totpAt(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 90_000), now)).toBe(false);
    expect(verifyTotp(s, 'abc123', now)).toBe(false);
  });

  it('cifra o segredo em repouso e detecta adulteração', () => {
    const sealed = sealSecret('ABCDEF');
    expect(sealed).not.toContain('ABCDEF');
    expect(openSecret(sealed)).toBe('ABCDEF');
    expect(() => openSecret(sealed.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toThrow();
  });
});
