import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';

import { UserType } from '../entities/user.entity';
import { IsStrongPassword } from '../../common/password';
import { ACCOUNT_TYPES, IsCpf, IsWebsite } from '../../common/br-validators';
import { BANK_CODES } from '../../common/banks';
import { IsIn, Matches, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsEmail()
  email!: string;

  @IsStrongPassword()
  password!: string;

  @IsEnum([UserType.ONG, UserType.DOADOR])
  type!: UserType.ONG | UserType.DOADOR;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  cnpj!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsWebsite()
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
  @MaxLength(100)
  district!: string;

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
  @MaxLength(80)
  bank!: string;

  // Banco escolhido na lista; se ausente, `bank` é texto livre ("Outro").
  @IsOptional()
  @IsIn(BANK_CODES, { message: 'Banco inválido.' })
  bankCode?: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @Matches(/^\d{4}$/, { message: 'A agência deve ter 4 dígitos.' })
  agency!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @Matches(/^\d{1,12}-?[\dxX]$/, { message: 'Conta inválida: use apenas números e o dígito (até 13 caracteres).' })
  account!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsIn([...ACCOUNT_TYPES], { message: 'Tipo de conta inválido.' })
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
  @IsCpf()
  legalCpf!: string;

  // Campos para Doador
  @IsOptional()
  @IsCpf()
  cpf?: string;
}
