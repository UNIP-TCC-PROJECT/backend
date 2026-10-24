import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString({ message: 'Link inválido.' })
  @IsNotEmpty({ message: 'Link inválido.' })
  @MaxLength(200, { message: 'Link inválido.' })
  token!: string;

  @IsString({ message: 'A senha deve ser um texto.' })
  @MinLength(6, { message: 'A senha deve ter pelo menos 6 caracteres.' })
  // O bcrypt só considera os primeiros 72 bytes da senha.
  @MaxLength(72, { message: 'A senha deve ter no máximo 72 caracteres.' })
  password!: string;
}
