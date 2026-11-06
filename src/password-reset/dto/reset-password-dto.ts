import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsStrongPassword } from '../../common/password';

export class ResetPasswordDto {
  @IsString({ message: 'Link inválido.' })
  @IsNotEmpty({ message: 'Link inválido.' })
  @MaxLength(200, { message: 'Link inválido.' })
  token!: string;

  @IsStrongPassword()
  password!: string;
}
