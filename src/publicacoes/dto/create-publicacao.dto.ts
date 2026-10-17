import { Transform } from 'class-transformer';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreatePublicacaoDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'A descrição deve ser um texto.' })
  @IsNotEmpty({ message: 'Informe a descrição da publicação.' })
  @MaxLength(2000, {
    message: 'A descrição deve ter no máximo 2.000 caracteres.',
  })
  description!: string;
}