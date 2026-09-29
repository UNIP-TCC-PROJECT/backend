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

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
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
  @IsString()
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
  bank!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  agency!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
  account!: string;

  @ValidateIf((data) => data.type === UserType.ONG)
  @IsString()
  @IsNotEmpty()
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
  legalCpf!: string;

  // Campos para Doador
  @IsOptional()
  @IsString()
  cpf?: string;
}
