import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Medalha } from './entities/medalha.entity';
import { AuthModule } from '../auth/auth.module';
import { MedalhaBrancaController } from './medalha-branca.controller';
import { MedalhaBrancaService } from './medalha-branca.service';

@Module({
  imports: [TypeOrmModule.forFeature([Medalha]), AuthModule],
  controllers: [MedalhaBrancaController],
  providers: [MedalhaBrancaService],
})
export class MedalhasModule {}
