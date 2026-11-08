import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetasController } from './metas.controller';
import { MetasService } from './metas.service';
import { Meta } from './entities/meta.entity';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Meta, User]),
    AuthModule,
    OrganizationsModule,
  ],
  controllers: [MetasController],
  providers: [MetasService],
  exports: [MetasService],
})
export class MetasModule { }
