import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidCpf } from '../organizations/cnpj.util';

/** CPF com 11 dígitos e dígitos verificadores válidos (aceita máscara). */
export function IsCpf(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isCpf',
      target: object.constructor,
      propertyName,
      options: { message: 'CPF inválido.', ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && v.length <= 14 && isValidCpf(v) },
    });
}

// Site com ou sem http(s):// — só http/https, com domínio (bloqueia javascript:, data:, ftp: etc.).
const SITE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;
export const isValidWebsite = (v: unknown) => typeof v === 'string' && v.length <= 200 && SITE.test(v.trim());

/** Guarda sempre com esquema: sem protocolo vira https://. */
export const normalizeWebsite = (v?: string | null) => {
  const t = v?.trim();
  if (!t) return undefined;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
};

export function IsWebsite(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isWebsite',
      target: object.constructor,
      propertyName,
      options: { message: 'Informe um site válido (ex.: www.minhaong.org.br).', ...options },
      validator: { validate: isValidWebsite },
    });
}

export const ACCOUNT_TYPES = ['Corrente', 'Poupança', 'Pagamento'] as const;
