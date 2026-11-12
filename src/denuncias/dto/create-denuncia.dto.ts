import { IsEnum, IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DenunciaTipoAlvo } from '../entities/denuncia.entity';

export class CreateDenunciaDto {
  @IsEnum(DenunciaTipoAlvo, {
    message: 'O tipo do alvo deve ser ONG, DOADOR ou COMENTARIO.',
  })
  tipoAlvo!: DenunciaTipoAlvo;

  @Type(() => Number)
  @IsInt({ message: 'O alvo denunciado é inválido.' })
  alvoId!: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o motivo da denúncia.' })
  @MinLength(10, { message: 'O motivo deve ter pelo menos 10 caracteres.' })
  @MaxLength(1000, { message: 'O motivo deve ter no máximo 1000 caracteres.' })
  motivo!: string;
}
