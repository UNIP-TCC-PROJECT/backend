
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from './users/users.module';
import { User } from './users/entities/user.entity';

import { Reviews } from './reviews/entities/reviews.entity';
import { ReviewsModule } from './reviews/reviews.module';

import { Meta } from './metas/entities/meta.entity';
import { MetasModule } from './metas/metas.module';

import { CnpjVerificationService } from './cnpj-verification/cnpj-verification.service';
import { CnpjVerificationController } from './cnpj-verification/cnpj-verification.controller';

import { Medalha } from './medalhas/entities/medalha.entity';
import { MedalhasModule } from './medalhas/medalhas.module';

import { Denuncia } from './denuncias/entities/denuncia.entity';
import { DenunciasModule } from './denuncias/denuncias.module';

import { Publicacao } from './publicacoes/entities/publicacao.entity';
import { PublicacoesModule } from './publicacoes/publicacoes.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'db',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER ?? process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_NAME ?? 'tcc_db',
      entities: [User, Reviews, Meta, Medalha, Denuncia, Publicacao],
      synchronize: true,
    }),

    UsersModule,
    ReviewsModule,
    MetasModule,
    AdminModule,
    MedalhasModule,
    DenunciasModule,
    PublicacoesModule,
  ],
  controllers: [CnpjVerificationController, AppController],
  providers: [CnpjVerificationService, AppService],
})
export class AppModule {}
