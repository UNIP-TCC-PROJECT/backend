import { Test, TestingModule } from '@nestjs/testing';
import { CnpjVerificationService } from './cnpj-verification.service';

describe('CnpjVerificationService', () => {
  let service: CnpjVerificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CnpjVerificationService],
    }).compile();

    service = module.get<CnpjVerificationService>(CnpjVerificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
