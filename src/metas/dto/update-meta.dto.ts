import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';

import { MetaType, MetaPriority } from '../entities/meta.entity';

export class UpdateMetaDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(MetaPriority)
  priority?: MetaPriority;

  // Descrição curta
  @IsOptional()
  @IsString()
  description?: string;

  // Descrição completa da campanha
  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsEnum(MetaType)
  type?: MetaType;

  // Metas financeiras
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAmount?: number;

  // Metas materiais e voluntariado
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetQuantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  // Futuramente podemos usar uma URL de imagem
  @IsOptional()
  @IsString()
  image?: string;
}
