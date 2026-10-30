
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from './users/users.module';
import { User } from './users/entities/user.entity';

import { Favorito } from './favoritos/entities/favorito.entity';
import { FavoritosModule } from './favoritos/favoritos.module';

import { Reviews } from './reviews/entities/reviews.entity';
import { ReviewsModule } from './reviews/reviews.module';

import { Meta } from './metas/entities/meta.entity';
import { MetasModule } from './metas/metas.module';

import { CnpjVerificationController } from './cnpj-verification/cnpj-verification.controller';
import { CnpjVerificationService } from './cnpj-verification/cnpj-verification.service';

import { Medalha } from './medalhas/entities/medalha.entity';
import {
  PedidoMedalhaBranca,
  DocumentoMedalhaBranca,
} from './medalhas/entities/pedido-medalha-branca.entity';
import { MedalhasModule } from './medalhas/medalhas.module';

import { Denuncia } from './denuncias/entities/denuncia.entity';
import { DenunciasModule } from './denuncias/denuncias.module';

import { Publicacao } from './publicacoes/entities/publicacao.entity';
import { PublicacoesModule } from './publicacoes/publicacoes.module';

import { Interesse } from './interesses/entities/interesse.entity';
import { InteressesModule } from './interesses/interesses.module';

import { Conversa } from './conversas/entities/conversa.entity';
import { Mensagem } from './conversas/entities/mensagem.entity';
import { ConversasModule } from './conversas/conversas.module';

import { AdminModule } from './admin/admin.module';

import { PasswordResetModule } from './password-reset/password-reset.module';
import { PasswordResetToken } from './password-reset/entities/password-reset-token.entity';

import { AuditModule } from './audit/audit.module';
import { AuditLog } from './audit/audit-log.entity';
import { Session } from './auth/entities/session.entity';
import { Organization } from './organizations/entities/organization.entity';
import { OrganizationDocument } from './organizations/entities/organization-document.entity';
import { OrganizationValidation } from './organizations/entities/organization-validation.entity';
import { OrganizationExternalCheck } from './organizations/entities/organization-external-check.entity';
import { OrganizationsModule } from './organizations/organizations.module';
import { Campaign } from './campaigns/entities/campaign.entity';
import { CampaignsModule } from './campaigns/campaigns.module';
import { Donation } from './donations/entities/donation.entity';
import { DonationsModule } from './donations/donations.module';
import { Expense, ExpenseDocument } from './accountability/entities/expense.entity';
import { DeliveryRecord, DeliveryEvidence } from './accountability/entities/delivery.entity';
import { AccountabilityModule } from './accountability/accountability.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'postgres-db',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER ?? process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_NAME ?? 'tcc_db',

      entities: [
        User,
        Reviews,
        Meta,
        Medalha,
        Denuncia,
        Publicacao,
        Favorito,
        Interesse,
        Conversa,
        Mensagem,
        PedidoMedalhaBranca,
        DocumentoMedalhaBranca,
        PasswordResetToken,
        Session,
        AuditLog,
        Organization,
        OrganizationDocument,
        OrganizationValidation,
        OrganizationExternalCheck,
        Campaign,
        Donation,
        Expense,
        ExpenseDocument,
        DeliveryRecord,
        DeliveryEvidence,
      ],

      synchronize: true,
    }),

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
