import { InternalServerErrorException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { DonationsService } from '../donations/donations.service';
import { PaymentEvent } from './payment-event.entity';

@Injectable()
export class AsaasWebhookService {
  private readonly logger = new Logger(AsaasWebhookService.name);

  constructor(
    @InjectRepository(PaymentEvent) private events: Repository<PaymentEvent>,
    private donations: DonationsService,
  ) {}

  /** Autenticação do webhook: o header `asaas-access-token` deve ser igual ao authToken configurado no Asaas. */
  private authenticate(received?: string) {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected) throw new ServiceUnavailableException('Webhook não configurado.');
    const a = Buffer.from(received ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Webhook Asaas rejeitado: token inválido.');
      throw new UnauthorizedException();
    }
  }

  async handle(token: string | undefined, body: any) {
    this.authenticate(token);
    if (!body || typeof body.id !== 'string' || typeof body.event !== 'string') return { received: false, reason: 'invalid_payload' };

    const paymentId: string | null = typeof body.payment?.id === 'string' ? body.payment.id : null;
    // Persiste o evento; id repetido = reenvio (entrega "at least once").
    const inserted = await this.events.createQueryBuilder().insert().values({ providerEventId: body.id, event: body.event, providerPaymentId: paymentId, payload: body }).orIgnore().returning('id').execute();
    const event = await this.events.findOneByOrFail({ providerEventId: body.id });
    if (!inserted.raw.length && event.processedAt) return { received: true, duplicate: true };

    if (!body.event.startsWith('PAYMENT_') || !paymentId) return this.finish(event, 'IGNORED_EVENT');

    try {
      const r = await this.donations.reconcile(paymentId, { kind: 'webhook', eventId: body.id });
      return this.finish(event, r.outcome);
    } catch (e) {
      // Falha ao consultar o provedor: não marca como processado e responde 5xx para o Asaas reenviar.
      await this.events.update(event.id, { outcome: 'ERROR' });
      this.logger.error(`Falha ao processar ${body.id}: ${(e as Error).message}`);
      throw new InternalServerErrorException();
    }
  }

  private async finish(event: PaymentEvent, outcome: string) {
    await this.events.update(event.id, { processedAt: new Date(), outcome });
    return { received: true, outcome };
  }
}
