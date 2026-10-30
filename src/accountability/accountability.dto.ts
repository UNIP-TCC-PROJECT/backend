import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateExpenseDto {
  @IsUUID() campaignId!: string;
  @IsString() @MinLength(5) @MaxLength(255) description!: string;
  @IsString() @MinLength(2) @MaxLength(60) category!: string;
  @IsInt() @Min(1) @Max(100_000_000_00) amountCents!: number;
  @IsDateString() spentAt!: string;
}

export class CreateDeliveryDto {
  @IsUUID() campaignId!: string;
  @IsString() @MinLength(5) @MaxLength(2000) description!: string;
  @IsDateString() deliveredAt!: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsString() @MaxLength(40) unit?: string;
}
