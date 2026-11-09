import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Denuncia } from './entities/denuncia.entity';
import { User } from '../users/entities/user.entity';
import { Reviews } from '../reviews/entities/reviews.entity';
import { DenunciasService } from './denuncias.service';
import { AdminDenunciasController, DenunciasController } from './denuncias.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([Denuncia, User, Reviews]), AuditModule],
  controllers: [DenunciasController, AdminDenunciasController],
  providers: [DenunciasService],
})
export class DenunciasModule {}
