import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PublicacoesService } from './publicacoes.service';
import { PublicacoesController } from './publicacoes.controller';
import { Publicacao } from './entities/publicacao.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Publicacao, User])],
  providers: [PublicacoesService],
  controllers: [PublicacoesController],
})
export class PublicacoesModule {}