import { openSecret, sealSecret } from './secret-box';

describe('secret-box', () => {
  const original = process.env.PAYMENT_ENCRYPTION_KEY;
  beforeEach(() => (process.env.PAYMENT_ENCRYPTION_KEY = 'k'.repeat(40)));
  afterAll(() => (process.env.PAYMENT_ENCRYPTION_KEY = original));

  it('cifra e abre com o mesmo dono, sem deixar o segredo à vista', () => {
    const sealed = sealSecret('$aact_chave_secreta_de_teste', 'org-1');
    expect(sealed).not.toContain('aact');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(openSecret(sealed, 'org-1')).toBe('$aact_chave_secreta_de_teste');
  });

  it('produz textos diferentes a cada cifragem (IV aleatório)', () => {
    expect(sealSecret('x', 'a')).not.toBe(sealSecret('x', 'a'));
  });

  it('não abre quando o dono é outro (texto copiado para a linha de outra ONG)', () => {
    expect(() => openSecret(sealSecret('segredo', 'org-1'), 'org-2')).toThrow();
  });

  it('detecta adulteração e formato inválido', () => {
    const sealed = sealSecret('segredo', 'org-1');
    const [v, iv, tag, data] = sealed.split('.');
    expect(() => openSecret([v, iv, tag, Buffer.from('outro').toString('base64url')].join('.'), 'org-1')).toThrow();
    expect(() => openSecret('lixo', 'org-1')).toThrow();
    expect(data).toBeTruthy();
  });

  it('não abre com outra chave mestra', () => {
    const sealed = sealSecret('segredo', 'org-1');
    process.env.PAYMENT_ENCRYPTION_KEY = 'z'.repeat(40);
    expect(() => openSecret(sealed, 'org-1')).toThrow();
  });

  it('recusa funcionar sem chave mestra forte (sem reserva silenciosa)', () => {
    process.env.PAYMENT_ENCRYPTION_KEY = 'curta';
    expect(() => sealSecret('x', 'a')).toThrow(/PAYMENT_ENCRYPTION_KEY/);
    delete process.env.PAYMENT_ENCRYPTION_KEY;
    expect(() => sealSecret('x', 'a')).toThrow(/PAYMENT_ENCRYPTION_KEY/);
  });
});
