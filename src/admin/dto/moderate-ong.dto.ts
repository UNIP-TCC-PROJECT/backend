import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length } from 'class-validator';

export enum OngModerationAction {
  RESTRINGIR = 'RESTRINGIR',
  REMOVER_RESTRICAO = 'REMOVER_RESTRICAO',
  SUSPENDER = 'SUSPENDER',
  BANIR = 'BANIR',
  REATIVAR = 'REATIVAR',
}

export class ModerateOngDto {
  @IsEnum(OngModerationAction)
  action!: OngModerationAction;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 1000, { message: 'Informe uma justificativa de 1 a 1000 caracteres.' })
  reason!: string;
}
