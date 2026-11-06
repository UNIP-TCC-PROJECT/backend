import { IsStrongPassword } from '../../common/password';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateAdminDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsStrongPassword()
  password!: string;
}