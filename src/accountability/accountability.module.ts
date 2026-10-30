import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { User } from '../users/entities/user.entity';
import { AccountabilityController } from './accountability.controller';
import { AccountabilityService } from './accountability.service';
import { DeliveryEvidence, DeliveryRecord } from './entities/delivery.entity';
import { Expense, ExpenseDocument } from './entities/expense.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, ExpenseDocument, DeliveryRecord, DeliveryEvidence, Campaign, User]), AuthModule, OrganizationsModule],
  controllers: [AccountabilityController],
  providers: [AccountabilityService],
})
export class AccountabilityModule {}
