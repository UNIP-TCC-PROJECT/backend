import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';

import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';

import { AuthModule } from '../auth/auth.module';
import { CnpjVerificationService } from '../cnpj-verification/cnpj-verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, CnpjVerificationService],
  exports: [UsersService],
})
export class UsersModule {}