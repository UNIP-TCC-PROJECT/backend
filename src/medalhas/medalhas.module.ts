import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Medalha } from './entities/medalha.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Medalha])],
})
export class MedalhasModule {}