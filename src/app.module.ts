
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from './users/users.module';

import { FavoritosModule } from './favoritos/favoritos.module';

import { ReviewsModule } from './reviews/reviews.module';

import { MetasModule } from './metas/metas.module';

import { CnpjVerificationController } from './cnpj-verification/cnpj-verification.controller';
import { CnpjVerificationService } from './cnpj-verification/cnpj-verification.service';

import { MedalhasModule } from './medalhas/medalhas.module';

import { DenunciasModule } from './denuncias/denuncias.module';

import { PublicacoesModule } from './publicacoes/publicacoes.module';

import { InteressesModule } from './interesses/interesses.module';

import { ConversasModule } from './conversas/conversas.module';

import { AdminModule } from './admin/admin.module';

import { PasswordResetModule } from './password-reset/password-reset.module';

import { AuditModule } from './audit/audit.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { DonationsModule } from './donations/donations.module';
import { PaymentsModule } from './payments/payments.module';
import { AccountabilityModule } from './accountability/accountability.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { dbOptions } from './database/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Schema só muda por migration (npm run migration:run). Conexão com o papel de runtime, sem DDL.
    TypeOrmModule.forRootAsync({ useFactory: () => dbOptions('runtime') }), // lido após o ConfigModule carregar o .env

    UsersModule,
    ReviewsModule,
    MetasModule,
    AdminModule,
    MedalhasModule,
    DenunciasModule,
    FavoritosModule,
    PublicacoesModule,
    InteressesModule,
    ConversasModule,
    PasswordResetModule,
    AuditModule,
    OrganizationsModule,
    CampaignsModule,
    DonationsModule,
    PaymentsModule,
    AccountabilityModule,
  ],

  controllers: [
    CnpjVerificationController,
    AppController,
  ],

  providers: [
    CnpjVerificationService,
    AppService,
  ],
})
export class AppModule {}
