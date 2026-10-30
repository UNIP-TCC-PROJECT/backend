import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';

const URLS = { sandbox: 'https://api-sandbox.asaas.com/v3', production: 'https://api.asaas.com/v3' };

export interface AsaasPayment {
  id: string;
  status: string;
  value: number;
  billingType: string;
  externalReference?: string | null;
  customer?: string;
  deleted?: boolean;
  dueDate?: string;
}

/** Cliente do Asaas. Sandbox por padrão; produção só com ASAAS_ENV=production explícito. */
@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);

  private get baseUrl() {
    return process.env.ASAAS_ENV === 'production' ? URLS.production : URLS.sandbox;
  }

  private async call<T>(method: 'get' | 'post', path: string, data?: object): Promise<T> {
    const key = process.env.ASAAS_API_KEY;
    if (!key) throw new ServiceUnavailableException('Pagamentos indisponíveis: ASAAS_API_KEY não configurada.');
    const config: AxiosRequestConfig = {
      method, url: `${this.baseUrl}${path}`, data, timeout: 10000, validateStatus: () => true,
      headers: { access_token: key, 'User-Agent': 'donatio-tcc', 'Content-Type': 'application/json' },
    };
    let res;
    try {
      res = await axios.request(config);
    } catch (e) {
      this.logger.warn(`Asaas ${method.toUpperCase()} ${path} falhou: ${(e as Error).message}`);
      throw new BadGatewayException('Provedor de pagamento indisponível. Tente novamente.');
    }
    if (res.status >= 400) {
      // Nunca repassa o corpo cru nem a chave; registra só o essencial.
      this.logger.warn(`Asaas ${method.toUpperCase()} ${path} → HTTP ${res.status} ${JSON.stringify(res.data?.errors ?? '')}`);
      throw new BadGatewayException(res.status === 400 ? `Pagamento recusado: ${res.data?.errors?.[0]?.description ?? 'dados inválidos'}` : 'Provedor de pagamento indisponível. Tente novamente.');
    }
    return res.data as T;
  }

  createCustomer(c: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    return this.call<{ id: string }>('post', '/customers', { ...c, notificationDisabled: true });
  }

  createPixPayment(p: { customer: string; value: number; dueDate: string; description: string; externalReference: string }) {
    return this.call<AsaasPayment>('post', '/payments', { ...p, billingType: 'PIX' });
  }

  getPayment(id: string) {
    return this.call<AsaasPayment>('get', `/payments/${encodeURIComponent(id)}`);
  }

  getPixQrCode(id: string) {
    return this.call<{ encodedImage: string; payload: string; expirationDate: string }>('get', `/payments/${encodeURIComponent(id)}/pixQrCode`);
  }
}
