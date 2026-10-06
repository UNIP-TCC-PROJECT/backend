import { Module } from '@nestjs/common';

import { UsersService } from './users.service';
import { UsersController } from './users.controller';

import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from './entities/user.entity';

import { AuthModule } from '../auth/auth.module';

import { CnpjVerificationService } from '../cnpj-verification/cnpj-verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuthModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    CnpjVerificationService,
  ],
})
export class UsersModule {}

