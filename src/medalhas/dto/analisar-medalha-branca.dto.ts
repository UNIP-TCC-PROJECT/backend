import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { StatusMedalhaBranca } from '../entities/pedido-medalha-branca.entity';

export class AnalisarMedalhaBrancaDto {
  @IsIn([StatusMedalhaBranca.Aprovado, StatusMedalhaBranca.Recusado])
  status!: StatusMedalhaBranca.Aprovado | StatusMedalhaBranca.Recusado;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  motivo?: string;
}
