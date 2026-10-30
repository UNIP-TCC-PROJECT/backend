import type { ValueTransformer } from 'typeorm';

// bigint do Postgres chega como string; valores monetários trafegam em centavos (number).
export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value == null ? value : Number(value)),
};
