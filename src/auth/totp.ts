import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// TOTP (RFC 6238, SHA-1, 6 dígitos, passo 30 s) com a biblioteca padrão do Node.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) ?? [])
    .map((c) => B32[parseInt(c.padEnd(5, '0'), 2)])
    .join('');
}

function b32decode(s: string): Buffer {
  const bits = [...s].map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function totpAt(secret: string, timeMs: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30000)));
  const h = createHmac('sha1', b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/** Aceita a janela atual e ±1 passo (tolerância de relógio). */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((step) => {
    const expected = Buffer.from(totpAt(secret, now + step * 30000));
    return timingSafeEqual(expected, Buffer.from(code));
  });
}

export function otpauthUri(email: string, secret: string): string {
  return `otpauth://totp/Donatio:${encodeURIComponent(email)}?secret=${secret}&issuer=Donatio`;
}

// Segredo MFA cifrado em repouso (AES-256-GCM).
function key(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!raw) throw new Error('MFA_ENCRYPTION_KEY ou JWT_SECRET deve estar definido.');
  return createHash('sha256').update(raw).digest();
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function openSecret(sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
