import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SaveReviewDto {
  @IsInt({
    message: 'A nota deve ser um número inteiro.',
  })
  @Min(1, {
    message: 'A nota mínima é 1.',
  })
  @Max(5, {
    message: 'A nota máxima é 5.',
  })
  nota!: number;

  @Transform(
    ({ value }) =>
      typeof value === 'string' ? value.trim() : value,
    { toClassOnly: true },
  )
  @IsOptional()
  @IsString({
    message: 'O comentário deve ser um texto.',
  })
  @Matches(/^[\s\S]{0,100}$/u, {
    message: 'O comentário deve ter no máximo 100 caracteres.',
  })
  comentario?: string | null;
}