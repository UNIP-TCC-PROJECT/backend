import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { BadRequestException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from '../auth/auth.service';

jest.mock('node:fs/promises', () => ({ mkdir: jest.fn(), writeFile: jest.fn() }));

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

  it('should save the avatar for the authenticated user (extensão definida pelos bytes, não pelo nome)', async () => {
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)]);
    const result = await controller.uploadAvatar({ buffer: png, originalname: 'x.html' } as Express.Multer.File, { user: { id: 42 } });
    expect(result.profileImage).toMatch(/^\/uploads\/avatars\/[\w-]+\.png$/);
    expect(mockUsersService.updateProfileImage).toHaveBeenCalledWith(42, result.profileImage);
  });

  it('should reject an avatar whose bytes are not an image', async () => {
    mockUsersService.updateProfileImage.mockClear();
    await expect(controller.uploadAvatar({ buffer: Buffer.from('<html><script>alert(1)</script></html>'), originalname: 'a.png' } as Express.Multer.File, { user: { id: 42 } })).rejects.toThrow(BadRequestException);
    expect(mockUsersService.updateProfileImage).not.toHaveBeenCalled();
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
