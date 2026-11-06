import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min, Max } from 'class-validator';
import { CATEGORIES } from '../publicacoes.constants';

export class PublicacoesQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 5;

  @IsOptional()
  @IsIn(CATEGORIES as unknown as string[])
  category?: string;
}
