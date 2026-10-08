import { Test, TestingModule } from '@nestjs/testing';
import { CnpjVerificationController } from './cnpj-verification.controller';

describe('CnpjVerificationController', () => {
  let controller: CnpjVerificationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CnpjVerificationController],
    }).compile();

    controller = module.get<CnpjVerificationController>(CnpjVerificationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
