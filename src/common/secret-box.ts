import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cofre de segredos de pagamento (chaves de API das subcontas), AES-256-GCM.
 *
 *  - A chave mestra vem de PAYMENT_ENCRYPTION_KEY (mín. 32 caracteres, só no servidor). Não há reserva silenciosa
 *    em outra variável: sem ela, nada é gravado nem lido.
 *  - `aad` amarra o segredo ao seu dono (id da organização): um texto cifrado copiado para a linha de outra ONG
 *    falha na verificação de autenticidade e não abre.
 *  - Formato: v1.<iv>.<tag>.<texto cifrado>, em base64url.
 */
const MIN_KEY_LENGTH = 32;

function masterKey(): Buffer {
  const raw = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!raw || raw.length < MIN_KEY_LENGTH) {
    throw new Error(`PAYMENT_ENCRYPTION_KEY (mínimo ${MIN_KEY_LENGTH} caracteres) deve estar definida para guardar credenciais de pagamento.`);
  }
  return createHash('sha256').update(raw).digest();
}

export function sealSecret(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function openSecret(sealed: string, aad: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Segredo em formato inválido.');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
