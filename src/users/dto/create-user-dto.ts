import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
} from 'class-validator';

export enum RegisterUserType {
  ONG = 'ONG',
  DOADOR = 'DOADOR',
}

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(RegisterUserType)
  type!: RegisterUserType;

  // Campos para ONG
  @IsOptional()
  @IsString()
  cnpj?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Campos para Doador
  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
