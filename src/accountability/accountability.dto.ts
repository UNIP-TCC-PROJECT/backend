import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isValidCnpj, isValidCpf, onlyDigits } from '../organizations/cnpj.util';
import { ExpenseDocumentKind } from './entities/expense.entity';
import { EvidenceKind } from './entities/delivery.entity';

@ValidatorConstraint({ name: 'cpfOrCnpj' })
class CpfOrCnpj implements ValidatorConstraintInterface {
  validate(v: string) { const d = onlyDigits(v); return d.length === 11 ? isValidCpf(d) : isValidCnpj(d); }
  defaultMessage() { return 'CPF/CNPJ do fornecedor inválido'; }
}

const MAX = 100_000_000_00;

export class CreateExpenseDto {
  @IsUUID() campaignId!: string;
  @IsString() @MinLength(5) @MaxLength(255) description!: string;
  @IsString() @MinLength(2) @MaxLength(60) category!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) supplier?: string;
  @IsOptional() @Validate(CpfOrCnpj) supplierDocument?: string;
  @IsInt() @Min(1) @Max(MAX) amountCents!: number;
  @IsDateString() spentAt!: string;
}

// Só campos descritivos/valor; status, totais e revisão nunca vêm do cliente.
export class UpdateExpenseDto {
  @IsOptional() @IsString() @MinLength(5) @MaxLength(255) description?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) supplier?: string;
  @IsOptional() @Validate(CpfOrCnpj) supplierDocument?: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX) amountCents?: number;
  @IsOptional() @IsDateString() spentAt?: string;
}

export class UploadExpenseDocumentDto {
  @IsEnum(ExpenseDocumentKind) kind!: ExpenseDocumentKind;
}

export class CreateDeliveryDto {
  @IsUUID() campaignId!: string;
  @IsOptional() @IsUUID() expenseId?: string;
  @IsString() @MinLength(3) @MaxLength(255) itemDescription!: string;
  @IsInt() @Min(0) @Max(10_000_000) quantityPurchased!: number;
  @IsInt() @Min(0) @Max(10_000_000) quantityDistributed!: number;
  @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @IsString() @MinLength(10) @MaxLength(3000) description!: string;
  @IsDateString() deliveredAt!: string;
  @IsString() @MinLength(2) @MaxLength(120) region!: string;
  @IsOptional() @IsString() @MaxLength(255) locationDetail?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160) responsibleName?: string;
}

export class UploadEvidenceDto {
  @IsEnum(EvidenceKind) kind!: EvidenceKind;
  @IsString() @MinLength(5) @MaxLength(1000) description!: string;
  @IsDateString() takenAt!: string;
  @IsOptional() @IsUUID() campaignId?: string;
  @IsOptional() @IsUUID() deliveryRecordId?: string;
}

export class UpdateEvidenceDto {
  @IsOptional() @IsString() @MinLength(5) @MaxLength(1000) description?: string;
  @IsOptional() @IsDateString() takenAt?: string;
}

export class ReviewActionDto {
  @IsIn(['INICIAR', 'APROVAR', 'REPROVAR', 'COMPLEMENTAR']) action!: 'INICIAR' | 'APROVAR' | 'REPROVAR' | 'COMPLEMENTAR';
  @IsOptional() @IsString() @MinLength(5) @MaxLength(1000) reason?: string;
  // Admin atesta que o arquivo pode ser exibido ao público (sem dados pessoais / já redigido).
  @IsOptional() @IsBoolean() publishable?: boolean;
}
