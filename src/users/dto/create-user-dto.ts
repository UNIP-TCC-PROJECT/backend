import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsUrl,
  ValidateIf,
  Matches,
  MaxLength,
  IsIn,
} from 'class-validator';

import { UserType } from '../entities/user.entity';

export class CreateUserDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'’&()\-]{2,99}$/u, {
    message:
      'O nome deve ter entre 3 e 100 caracteres e usar letras, números, espaços ou pontuação comum.',
  })
  @MinLength(3)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,}$/, {
    message:
      'A senha deve ter ao menos 8 caracteres, uma letra maiúscula, uma minúscula, um número e um caractere especial.',
  })
  password!: string;

  @IsEnum([UserType.ONG, UserType.DOADOR])
  type!: UserType.ONG | UserType.DOADOR;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  cnpj!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty({ message: 'A descrição é obrigatória.' })
  @MinLength(20, {
    message: 'A descrição deve ter pelo menos 20 caracteres.',
  })
  @MaxLength(1000, {
    message: 'A descrição não pode passar de 1000 caracteres.',
  })
  @Matches(/\S/, {
    message: 'A descrição não pode conter apenas espaços.',
  })
  description!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ValidateIf(
    (data) =>
      data.type === UserType.ONG ||
      (typeof data.phone === 'string' && data.phone.trim() !== ''),
  )
  @IsString()
  @IsNotEmpty({ message: 'O telefone é obrigatório para ONGs.' })
  @Matches(/^\(?[1-9]\d\)?\s?\d{4,5}-?\d{4}$/, {
    message: 'Informe um telefone válido com DDD.',
  })
  phone?: string;

  @ValidateIf(
    (data) =>
      data.website !== undefined &&
      data.website !== null &&
      data.website !== '',
  )
  @IsString()
  @IsUrl(
    { require_protocol: false },
    { message: 'Informe um site válido, como meusite.org.' },
  )
  website?: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  zip!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  street!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  state!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  @MinLength(2, {
    message: 'Informe o nome do banco com pelo menos 2 caracteres.',
  })
  @MaxLength(80, {
    message: 'O nome do banco não pode passar de 80 caracteres.',
  })
  @Matches(/^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'’&()\/-]{1,79}$/u, {
    message: 'Informe um nome de banco válido.',
  })
  bank!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,6}(?:-[0-9X])?$/i, {
    message:
      'Informe uma agência com até 6 dígitos e, se houver, o dígito verificador após hífen.',
  })
  agency!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,20}(?:-[0-9X])?$/i, {
    message:
      'Informe uma conta com até 20 dígitos e, se houver, o dígito verificador após hífen.',
  })
  account!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  @IsIn(['corrente', 'poupanca'], {
    message: 'Selecione conta corrente ou poupança.',
  })
  accountType!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  pixKey!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  legalName!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/, {
    message: 'Informe um CPF válido.',
  })
  legalCpf!: string;

  @ValidateIf((data) => data.type === UserType.DOADOR)
  @IsString()
  @IsNotEmpty({ message: 'O CPF é obrigatório para doadores.' })
  @Matches(/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/, {
    message: 'Informe um CPF válido.',
  })
  cpf!: string;
}
