import { Type } from 'class-transformer';
import { IsInt, Min, Max } from 'class-validator';

export class ReviewsQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'A página deve ser um número inteiro.' })
  @Min(1, { message: 'A página mínima é 1.' })
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'O limite deve ser um número inteiro.' })
  @Min(1, { message: 'O limite mínimo é 1.' })
  @Max(20, { message: 'O limite máximo é 20.' })
  limit: number = 5;
}