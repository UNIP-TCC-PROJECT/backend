import { ConfigService } from '@nestjs/config';
import { JwtSignOptions } from '@nestjs/jwt';

export const JWT_DEFAULT_EXPIRES_IN = '8h';

export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');

  if (!secret) {
    throw new Error(
      'JWT_SECRET não definido. Configure a variável de ambiente (veja .env.example).',
    );
  }

  return secret;
}

export function getJwtExpiresIn(
  config: ConfigService,
): JwtSignOptions['expiresIn'] {
  return (config.get<string>('JWT_EXPIRES_IN') ??
    JWT_DEFAULT_EXPIRES_IN) as JwtSignOptions['expiresIn'];
}
