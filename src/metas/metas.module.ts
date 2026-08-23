import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Meta } from './entities/meta.entity';
import { User } from '../users/entities/user.entity';
import { MetasController } from './metas.controller';
import { MetasService } from './metas.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Meta, User]),
  ],
  controllers: [MetasController],
  providers: [MetasService],
})
export class MetasModule {}