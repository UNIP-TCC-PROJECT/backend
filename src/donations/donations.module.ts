import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { User } from '../users/entities/user.entity';
import { AsaasService } from '../payments/asaas.service';
import { DonationsController } from './donations.controller';
import { DonationsService } from './donations.service';
import { Donation } from './entities/donation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Donation, Campaign, User]), AuthModule, OrganizationsModule],
  controllers: [DonationsController],
  providers: [DonationsService, AsaasService],
  exports: [DonationsService],
})
export class DonationsModule {}
