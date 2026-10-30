import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCampaignDto {
  @IsString() @MinLength(5) @MaxLength(160) title!: string;
  @IsString() @MinLength(20) @MaxLength(5000) description!: string;
  @IsString() @MinLength(10) @MaxLength(1000) objective!: string;
  @IsInt() @Min(1_00) @Max(100_000_000_00) goalCents!: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
}

export class UpdateCampaignDto {
  @IsOptional() @IsString() @MinLength(5) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MinLength(20) @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) objective?: string;
  @IsOptional() @IsInt() @Min(1_00) @Max(100_000_000_00) goalCents?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
}

export class CampaignStatusDto {
  @IsIn(['ATIVA', 'ENCERRADA']) status!: 'ATIVA' | 'ENCERRADA';
}
