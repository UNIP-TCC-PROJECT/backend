import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MetasService } from './metas.service';
import { Meta } from './entities/meta.entity';
import { User, UserType } from '../users/entities/user.entity';

describe('MetasService', () => {
  let service: MetasService;

  const mockMetaRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((data) => data),
    save: jest.fn((data) => Promise.resolve(data)),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetasService,
        { provide: getRepositoryToken(Meta), useValue: mockMetaRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get<MetasService>(MetasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should not allow an ONG to update a meta belonging to another ONG', async () => {
    mockMetaRepo.findOne.mockResolvedValue({ id: 1, ongId: 99 });

    await expect(
      service.update(1, 42, { title: 'Tentativa indevida' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should not allow an ONG to deactivate a meta belonging to another ONG', async () => {
    mockMetaRepo.findOne.mockResolvedValue({ id: 1, ongId: 99 });

    await expect(service.deactivate(1, 42)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should throw NotFoundException when the meta does not exist', async () => {
    mockMetaRepo.findOne.mockResolvedValue(null);

    await expect(service.update(1, 42, {} as any)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should allow the owning ONG to update its own meta', async () => {
    mockMetaRepo.findOne.mockResolvedValue({ id: 1, ongId: 42, title: 'Antiga' });

    const result = await service.update(1, 42, { title: 'Nova' } as any);

    expect(result.title).toBe('Nova');
    expect(mockMetaRepo.save).toHaveBeenCalled();
  });

  it('should allow the owning ONG to deactivate its own meta', async () => {
    mockMetaRepo.findOne.mockResolvedValue({ id: 1, ongId: 42, active: true });

    const result = await service.deactivate(1, 42);

    expect(result.active).toBe(false);
  });

  it('should create a meta bound to the authenticated ONG id, ignoring any other ongId', async () => {
    mockUserRepo.findOne.mockResolvedValue({ id: 42, type: UserType.ONG });

    const result = await service.create({ title: 'Meta' } as any, 42);

    expect(result.ongId).toBe(42);
  });
});
