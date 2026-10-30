import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Donation } from '../donations/entities/donation.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { User } from '../users/entities/user.entity';
import { AccountabilityController, TransparencyController } from './accountability.controller';
import { AccountabilityService } from './accountability.service';
import { DeliveryEvidence, DeliveryRecord } from './entities/delivery.entity';
import { Expense, ExpenseDocument } from './entities/expense.entity';
import { TransparencyService } from './transparency.service';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, ExpenseDocument, DeliveryRecord, DeliveryEvidence, Campaign, Donation, Organization, User]), AuthModule, OrganizationsModule],
  controllers: [AccountabilityController, TransparencyController],
  providers: [AccountabilityService, TransparencyService],
  exports: [AccountabilityService],
})
export class AccountabilityModule {}
