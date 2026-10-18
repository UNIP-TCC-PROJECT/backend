import { Test, TestingModule } from '@nestjs/testing';
import { CnpjVerificationController } from './cnpj-verification.controller';
import { CnpjVerificationService } from './cnpj-verification.service';

describe('CnpjVerificationController', () => {
  let controller: CnpjVerificationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CnpjVerificationController],
      providers: [
        { provide: CnpjVerificationService, useValue: { consultarCnpj: jest.fn() } },
      ],
    }).compile();

    controller = module.get<CnpjVerificationController>(CnpjVerificationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
