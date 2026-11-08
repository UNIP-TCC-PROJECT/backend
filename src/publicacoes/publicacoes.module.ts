import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PublicacoesService } from './publicacoes.service';
import { PublicacoesController } from './publicacoes.controller';
import { Publicacao } from './entities/publicacao.entity';
import { PublicacaoAnexo } from './entities/publicacao-anexo.entity';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Expense } from '../accountability/entities/expense.entity';
import { DeliveryRecord, DeliveryEvidence } from '../accountability/entities/delivery.entity';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [TypeOrmModule.forFeature([Publicacao, PublicacaoAnexo, User, Organization, Campaign, Expense, DeliveryRecord, DeliveryEvidence]), OrganizationsModule],
  providers: [PublicacoesService],
  controllers: [PublicacoesController],
})
export class PublicacoesModule {}
