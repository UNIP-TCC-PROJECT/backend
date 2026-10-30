import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { BadRequestException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from '../auth/auth.service';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    create: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    updateProfileImage: jest.fn(),
    findAllUsers: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        { provide: AuthService, useValue: { login: jest.fn() } },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should save the avatar for the authenticated user', async () => {
    const result = await controller.uploadAvatar(
      { filename: 'avatar.png' } as Express.Multer.File,
      { user: { id: 42 } },
    );
    expect(mockUsersService.updateProfileImage).toHaveBeenCalledWith(
      42, '/uploads/avatars/avatar.png',
    );
    expect(result).toEqual({ profileImage: '/uploads/avatars/avatar.png' });
  });

  it('should reject an avatar request without a file', async () => {
    await expect(controller.uploadAvatar(undefined as any, { user: { id: 42 } }))
      .rejects.toThrow(BadRequestException);
  });

  it('should preserve the administrative user listing', () => {
    controller.findAllUsers();
    expect(mockUsersService.findAllUsers).toHaveBeenCalled();
  });
});
