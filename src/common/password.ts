import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

const COMMON = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'senha123', 'senha1234', 'qwertyui', 'qwerty123', 'abc12345', 'iloveyou', '11111111', '00000000', 'admin123', 'administrador', 'brasil123', 'mudar123', 'trocar123']);

@ValidatorConstraint({ name: 'strongPassword' })
class StrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(v: unknown) {
    if (typeof v !== 'string') return false;
    return v.length >= 8 && !COMMON.has(v.toLowerCase()) && new Set(v).size > 3;
  }
  defaultMessage() {
    return 'Senha fraca: use ao menos 8 caracteres, sem sequências ou senhas comuns.';
  }
}

/** Mínimo de 8 caracteres (máx. 72: limite efetivo do bcrypt), sem senhas comuns/repetitivas. */
export const IsStrongPassword = () => applyDecorators(IsString(), MinLength(8), MaxLength(72), Validate(StrongPasswordConstraint));
