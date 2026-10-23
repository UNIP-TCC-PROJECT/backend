import { IsString, MaxLength, MinLength } from 'class-validator';

export class EnviarMensagemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  texto!: string;
}
