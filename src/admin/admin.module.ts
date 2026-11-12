import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { OngModerationService } from './ong-moderation.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), UsersModule, AuthModule],
  controllers: [AdminController],
  providers: [OngModerationService],
})
export class AdminModule {}
