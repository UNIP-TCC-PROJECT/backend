import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DenunciaStatus } from '../entities/denuncia.entity';

export class ReviewDenunciaDto {
  @IsIn([
    DenunciaStatus.EM_ANALISE,
    DenunciaStatus.PROCEDENTE,
    DenunciaStatus.IMPROCEDENTE,
  ])
  decision!: DenunciaStatus.EM_ANALISE | DenunciaStatus.PROCEDENTE | DenunciaStatus.IMPROCEDENTE;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  note?: string;
}
