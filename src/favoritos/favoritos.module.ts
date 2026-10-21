import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FavoritosController } from './favoritos.controller';
import { FavoritosService } from './favoritos.service';
import { Favorito } from './entities/favorito.entity';
import { User } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Favorito, User]), AuthModule],
  controllers: [FavoritosController],
  providers: [FavoritosService],
})
export class FavoritosModule {}