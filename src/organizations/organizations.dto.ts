import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, Validate, ValidateIf, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isValidCpf } from './cnpj.util';
import { OrganizationDocumentType } from './entities/organization-document.entity';

@ValidatorConstraint({ name: 'cpf' })
class CpfConstraint implements ValidatorConstraintInterface {
  validate(v: string) { return isValidCpf(v); }
  defaultMessage() { return 'CPF inválido'; }
}

const digits = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value);

// O CNPJ não é editável aqui: vem do cadastro da conta e é conferido na BrasilAPI.
export class UpdateOrganizationDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(160) tradeName?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @IsOptional() @Transform(digits) @Matches(/^\d{10,11}$/, { message: 'Telefone inválido' }) phone?: string;
  @IsOptional() @Transform(digits) @Matches(/^\d{8}$/, { message: 'CEP inválido' }) zip?: string;
  @IsOptional() @IsString() @MaxLength(200) street?: string;
  @IsOptional() @IsString() @MaxLength(20) number?: string;
  @IsOptional() @IsString() @MaxLength(100) complement?: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @Matches(/^[A-Za-z]{2}$/, { message: 'UF inválida' }) state?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160) legalRepName?: string;
  @IsOptional() @Transform(digits) @Validate(CpfConstraint) legalRepCpf?: string;
  @IsOptional() @IsString() @MaxLength(100) legalRepRole?: string;
  @IsOptional() @IsEmail() legalRepEmail?: string;
  @IsOptional() @Transform(digits) @Matches(/^\d{10,11}$/, { message: 'Telefone inválido' }) legalRepPhone?: string;
}

export class RequestDocumentsDto {
  @IsString() @MinLength(10) @MaxLength(1000) message!: string;
}

export class UploadDocumentDto {
  @IsEnum(OrganizationDocumentType) type!: OrganizationDocumentType;
}

export class ReviewDto {
  @IsIn(['APROVAR', 'REPROVAR']) decision!: 'APROVAR' | 'REPROVAR';

  @ValidateIf((o) => o.decision === 'REPROVAR')
  @IsString() @MinLength(5) @MaxLength(1000)
  reason?: string;

  // Aprovar com consultas pendentes/alertas exige justificativa explícita do analista (fica no histórico e na auditoria).
  @IsOptional() @IsString() @MinLength(10) @MaxLength(1000)
  overrideReason?: string;
}

export class ReasonDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
