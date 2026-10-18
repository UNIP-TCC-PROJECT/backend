import { Test, TestingModule } from '@nestjs/testing';
import { MetasController } from './metas.controller';
import { MetasService } from './metas.service';

describe('MetasController', () => {
  let controller: MetasController;

  const mockMetasService = {
    findMine: jest.fn(),
    findByOng: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetasController],
      providers: [
        {
          provide: MetasService,
          useValue: mockMetasService,
        },
      ],
    }).compile();

    controller = module.get<MetasController>(MetasController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should derive the ongId from the authenticated user on create', () => {
    const req = { user: { id: 42, email: 'ong@example.com' } };
    const dto = { title: 'Nova meta' } as any;

    controller.create(req, dto);

    expect(mockMetasService.create).toHaveBeenCalledWith(42, dto);
  });

  it('should pass the authenticated user id when updating a meta', () => {
    const req = { user: { id: 42, email: 'ong@example.com' } };
    const dto = { title: 'Meta atualizada' } as any;

    controller.update(7, dto, req);

    expect(mockMetasService.update).toHaveBeenCalledWith(7, 42, dto);
  });

  it('should pass the authenticated user id when deactivating a meta', () => {
    const req = { user: { id: 42, email: 'ong@example.com' } };

    controller.deactivate(7, req);

    expect(mockMetasService.deactivate).toHaveBeenCalledWith(7, 42);
  });
});
