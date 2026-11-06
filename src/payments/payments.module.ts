import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DonationsModule } from '../donations/donations.module';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { AsaasService } from './asaas.service';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { AsaasWebhookService } from './asaas-webhook.service';
import { OrganizationPaymentAccount } from './entities/organization-payment-account.entity';
import { AdminPaymentAccountsController, PaymentAccountsController } from './payment-accounts.controller';
import { PaymentAccountsService } from './payment-accounts.service';
import { PaymentEvent } from './payment-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEvent, OrganizationPaymentAccount, Organization, User]), DonationsModule, AuthModule],
  controllers: [AsaasWebhookController, PaymentAccountsController, AdminPaymentAccountsController],
  providers: [AsaasWebhookService, AsaasService, PaymentAccountsService],
  exports: [PaymentAccountsService],
})
export class PaymentsModule {}
