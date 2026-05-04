import { IsEmail, IsString, MinLength, IsEnum, IsOptional } from 'class-validator';
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

  @IsEnum(UserType)
  type!: UserType;

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