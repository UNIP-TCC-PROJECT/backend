import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CATEGORIES } from '../publicacoes.constants';

const bool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);
const empty = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class CreatePublicacaoDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'A descrição deve ser um texto.' })
  @IsNotEmpty({ message: 'Informe a descrição da publicação.' })
  @MaxLength(2000, {
    message: 'A descrição deve ter no máximo 2.000 caracteres.',
  })
  description!: string;

  @IsOptional() @IsIn(CATEGORIES as unknown as string[], { message: 'Categoria inválida.' })
  category?: string;

  // Vínculos com a prestação de contas (precisam pertencer à própria ONG).
  @Transform(empty) @IsOptional() @IsUUID() campaignId?: string;
  @Transform(empty) @IsOptional() @IsUUID() expenseId?: string;
  @Transform(empty) @IsOptional() @IsUUID() deliveryRecordId?: string;

  // Declaração de autorização de uso de imagem (obrigatória quando há imagem).
  @Transform(bool) @IsOptional() @IsBoolean() imageConsent?: boolean;
}

export class AttachmentDto {
  @Transform(bool) @IsOptional() @IsBoolean() imageConsent?: boolean;
}
