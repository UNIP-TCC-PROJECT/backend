import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { AsaasWebhookService } from './asaas-webhook.service';

@Controller('webhooks')
export class AsaasWebhookController {
  constructor(private svc: AsaasWebhookService) {}

  @Post('asaas')
  @HttpCode(200)
  receive(@Headers('asaas-access-token') token: string | undefined, @Body() body: unknown) {
    return this.svc.handle(token, body);
  }
}
