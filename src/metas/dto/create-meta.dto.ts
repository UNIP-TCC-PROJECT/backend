import { IsString, IsNumber, IsBoolean, IsDateString, IsOptional, IsEnum, Min, MaxLength } from 'class-validator';
import { MetaType, MetaPriority } from '../entities/meta.entity';

export class CreateMetaDto {
  @IsString()
  @MaxLength(255)
  title!: string;  // ← Adicione o "!" aqui

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(MetaType)
  type?: MetaType;

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
  deadline?: Date;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEnum(MetaPriority)
  priority?: MetaPriority;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsString()
  image?: string;
}