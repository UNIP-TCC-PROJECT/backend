import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Denuncia } from './entities/denuncia.entity';
import { User } from '../users/entities/user.entity';
import { Reviews } from '../reviews/entities/reviews.entity';
import { DenunciasService } from './denuncias.service';
import { DenunciasController } from './denuncias.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Denuncia, User, Reviews])],
  controllers: [DenunciasController],
  providers: [DenunciasService],
})
export class DenunciasModule {}
