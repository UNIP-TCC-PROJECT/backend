import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { Interesse } from './entities/interesse.entity';
import { InteressesController } from './interesses.controller';
import { InteressesService } from './interesses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Interesse, User]), AuthModule],
  controllers: [InteressesController],
  providers: [InteressesService],
})
export class InteressesModule {}
