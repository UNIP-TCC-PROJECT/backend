import { Controller, Get, Param, Query } from '@nestjs/common';

import { CnpjVerificationService } from './cnpj-verification.service';

@Controller('cnpj-verification')
export class CnpjVerificationController {
  constructor(
    private readonly cnpjVerificationService: CnpjVerificationService,
  ) {}

  @Get(':cnpj')
  consultar(
    @Param('cnpj') cnpj: string,
    @Query('nome') nome?: string,
  ) {
    return this.cnpjVerificationService.consultarCnpj(cnpj, nome);
  }
}