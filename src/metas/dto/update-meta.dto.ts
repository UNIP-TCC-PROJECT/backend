import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsEnum,
  Min,
  MaxLength,
} from 'class-validator';

import { MetaType, MetaPriority } from '../entities/meta.entity';

export class UpdateMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsEnum(MetaType)
  type?: MetaType;

  @IsOptional()
  @IsEnum(MetaPriority)
  priority?: MetaPriority;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  currentAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  currentQuantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  image?: string;
}