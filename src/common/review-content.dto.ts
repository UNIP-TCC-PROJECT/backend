import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewContentDto {
  @IsIn(['APROVAR', 'REPROVAR'])
  decision!: 'APROVAR' | 'REPROVAR';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
