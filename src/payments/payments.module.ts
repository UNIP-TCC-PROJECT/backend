import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DonationsModule } from '../donations/donations.module';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { AsaasWebhookService } from './asaas-webhook.service';
import { PaymentEvent } from './payment-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEvent]), DonationsModule],
  controllers: [AsaasWebhookController],
  providers: [AsaasWebhookService],
})
export class PaymentsModule {}
