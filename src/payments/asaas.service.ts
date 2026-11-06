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

/** Erro do provedor com o essencial para decidir (status HTTP e mensagem curta). Nunca carrega chave nem corpo cru. */
export class AsaasError extends BadGatewayException {
  constructor(message: string, readonly providerStatus?: number, readonly providerMessage?: string) {
    super(message);
  }
}

export interface AsaasSubaccount { id: string; walletId: string; apiKey: string }
export interface AsaasAccountStatus { general: string; commercialInfo?: string; bankAccountInfo?: string; documentation?: string }

/** Cliente do Asaas. Sandbox por padrão; produção só com ASAAS_ENV=production explícito. */
@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);

  private get baseUrl() {
    return process.env.ASAAS_ENV === 'production' ? URLS.production : URLS.sandbox;
  }

  /** `apiKey` é a credencial da subconta; sem ela, usa a chave da conta da plataforma (apenas onde isso é intencional). */
  private async call<T>(method: 'get' | 'post' | 'delete', path: string, data?: object, apiKey?: string): Promise<T> {
    const key = apiKey ?? process.env.ASAAS_API_KEY;
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
      throw new AsaasError('Provedor de pagamento indisponível. Tente novamente.');
    }
    if (res.status >= 400) {
      // Nunca repassa o corpo cru nem a chave; registra só o essencial.
      this.logger.warn(`Asaas ${method.toUpperCase()} ${path} → HTTP ${res.status} ${JSON.stringify(res.data?.errors ?? '')}`);
      const detail = String(res.data?.errors?.[0]?.description ?? res.data?.message ?? '').slice(0, 300) || undefined;
      throw new AsaasError(res.status === 400 ? `Pagamento recusado: ${res.data?.errors?.[0]?.description ?? 'dados inválidos'}` : 'Provedor de pagamento indisponível. Tente novamente.', res.status, detail);
    }
    return res.data as T;
  }

  /** Resposta fora do formato esperado = provedor com problema: nunca seguimos adiante "no escuro". */
  private expect<T>(data: any, ok: boolean): T {
    if (!ok) {
      this.logger.warn('Asaas devolveu resposta em formato inesperado.');
      throw new BadGatewayException('Provedor de pagamento indisponível. Tente novamente.');
    }
    return data as T;
  }

  async createCustomer(c: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    const d = await this.call<{ id: string }>('post', '/customers', { ...c, notificationDisabled: true });
    return this.expect<{ id: string }>(d, typeof d?.id === 'string' && /^cus_\w+$/.test(d.id));
  }

  async createPixPayment(p: { customer: string; value: number; dueDate: string; description: string; externalReference: string }) {
    const d = await this.call<AsaasPayment>('post', '/payments', { ...p, billingType: 'PIX' });
    return this.expect<AsaasPayment>(d, typeof d?.id === 'string' && /^pay_\w+$/.test(d.id) && typeof d.status === 'string');
  }

  async getPayment(id: string) {
    const d = await this.call<AsaasPayment>('get', `/payments/${encodeURIComponent(id)}`);
    return this.expect<AsaasPayment>(d, typeof d?.id === 'string' && typeof d.status === 'string' && Number.isFinite(Number(d.value)));
  }

  async getPixQrCode(id: string) {
    const d = await this.call<{ encodedImage: string; payload: string; expirationDate: string }>('get', `/payments/${encodeURIComponent(id)}/pixQrCode`);
    return this.expect<typeof d>(d, typeof d?.payload === 'string' && d.payload.length > 10);
  }

  /** Cancela (remove) uma cobrança ainda não paga, para que ela não possa ser quitada sem doação correspondente. */
  async deletePayment(id: string) {
    const d = await this.call<{ deleted?: boolean }>('delete', `/payments/${encodeURIComponent(id)}`);
    return this.expect<{ deleted: boolean }>(d, d?.deleted === true);
  }

  // ---------- Subcontas (credenciais por ONG) ----------

  /** Cria a subconta (usa a chave da conta da plataforma, que precisa ser pessoa jurídica). A apiKey só vem agora. */
  async createSubaccount(p: Record<string, unknown>): Promise<AsaasSubaccount> {
    const d = await this.call<any>('post', '/accounts', p);
    // A documentação mostra a chave em accessToken.apiKey, e a prosa a cita no topo: aceitamos os dois formatos.
    const apiKey = d?.accessToken?.apiKey ?? d?.apiKey;
    return this.expect<AsaasSubaccount>(
      { id: d?.id, walletId: d?.walletId, apiKey },
      typeof d?.id === 'string' && typeof d?.walletId === 'string' && typeof apiKey === 'string' && apiKey.length >= 20,
    );
  }

  /** Situação cadastral da subconta, consultada com a credencial dela. */
  async getAccountStatus(apiKey: string): Promise<AsaasAccountStatus> {
    const d = await this.call<any>('get', '/myAccount/status', undefined, apiKey);
    return this.expect<AsaasAccountStatus>(d, typeof d?.general === 'string');
  }

  /** Somente Sandbox: aprova a subconta (a aprovação de produção é cadastral e feita pelo Asaas). */
  async approveSandboxSubaccount(accountId: string) {
    if (process.env.ASAAS_ENV === 'production') throw new ServiceUnavailableException('Aprovação manual existe apenas no Sandbox.');
    return this.call<unknown>('post', `/accounts/${encodeURIComponent(accountId)}/approve`);
  }
}
