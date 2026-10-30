import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { OrganizationDocumentType } from './entities/organization-document.entity';

export class UpdateOrganizationDto {
  @IsOptional() @IsString() @MaxLength(160) tradeName?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class UploadDocumentDto {
  @IsEnum(OrganizationDocumentType) type!: OrganizationDocumentType;
}

export class ReviewDto {
  @IsIn(['APROVAR', 'REPROVAR']) decision!: 'APROVAR' | 'REPROVAR';

  @ValidateIf((o) => o.decision === 'REPROVAR')
  @IsString() @MinLength(5) @MaxLength(1000)
  reason?: string;
}

export class ReasonDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
