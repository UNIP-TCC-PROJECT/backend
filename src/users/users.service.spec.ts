import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { User, UserStatus, UserType } from './entities/user.entity';
import { CnpjVerificationService } from '../cnpj-verification/cnpj-verification.service';

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findOne: jest.fn(), find: jest.fn(), update: jest.fn(),
    save: jest.fn((user) => Promise.resolve(user)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: CnpjVerificationService, useValue: { consultarCnpj: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  afterEach(() => jest.restoreAllMocks());

  it('should save a profile image without replacing other user data', async () => {
    repo.findOne.mockResolvedValue({ id: 42, name: 'ONG' });
    await expect(service.updateProfileImage(42, '/uploads/avatars/photo.png'))
      .resolves.toEqual({ profileImage: '/uploads/avatars/photo.png' });
    expect(repo.update).toHaveBeenCalledWith(42, { profileImage: '/uploads/avatars/photo.png' });
  });

  it('should reject an avatar update for a missing user', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.updateProfileImage(42, '/uploads/avatars/photo.png'))
      .rejects.toThrow(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('should keep passwords out of the administrative user listing', async () => {
    repo.find.mockResolvedValue([{ id: 42, name: 'ONG', password: 'secret' }]);
    await expect(service.findAllUsers()).resolves.toEqual([{ id: 42, name: 'ONG' }]);
  });

  it('should prevent profile edits from changing account role or status', async () => {
    repo.findOne.mockResolvedValue({ id: 42, name: 'Old', type: UserType.ONG, status: UserStatus.ATIVO, password: 'hash' });
    const result = await service.updateProfile(42, { name: 'New', type: UserType.ADMIN, status: 'BANIDO' } as any);
    expect(result).toMatchObject({ name: 'New', type: UserType.ONG, status: UserStatus.ATIVO });
    expect(result).not.toHaveProperty('password');
  });
});
