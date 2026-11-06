import { migrateSchema, migratorConn, runtimeOptions } from './helpers/db';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import axios from 'axios';
import request from 'supertest';
import { ENTITIES } from '../src/database/entities';
import { AuditModule } from '../src/audit/audit.module';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Session } from '../src/auth/entities/session.entity';
import { openSecret } from '../src/common/secret-box';
import { Organization, OrganizationStatus } from '../src/organizations/entities/organization.entity';
import { OrganizationPaymentAccount, PaymentAccountStatus } from '../src/payments/entities/organization-payment-account.entity';
import { PaymentAccountsService } from '../src/payments/payment-accounts.service';
import { PaymentsModule } from '../src/payments/payments.module';
import { User, UserStatus, UserType } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';

// Execute com a infraestrutura de e2e (PostgreSQL descartável + migrations reais). O Asaas é simulado em memória:
// este teste valida o NOSSO código; a homologação no Sandbox real depende de uma conta pessoa jurídica.
describe('Subcontas de pagamento por ONG (PostgreSQL, Asaas simulado)', () => {
  jest.setTimeout(60000);
  process.env.JWT_SECRET ??= 'e2e-secret';
  process.env.PAYMENT_ENCRYPTION_KEY = 'e'.repeat(48);
  process.env.ASAAS_API_KEY = 'chave-plataforma-teste';
  process.env.ASAAS_ENV = 'sandbox';
  const schema = `teste_subcontas_${process.pid}_${Date.now()}`;
  let bootstrap: DataSource;
  let db: DataSource;
  let app: NestExpressApplication;
  let svc: PaymentAccountsService;
  const http = () => request(app.getHttpServer());

  let adminToken: string;
  let doadorToken: string;
  let tokenA: string;
  let tokenB: string;
  let orgA: Organization;
  let orgB: Organization;
  let userA: User;
  let userB: User;

  // ---- Asaas simulado ----
  const accounts = new Map<string, { id: string; walletId: string; apiKey: string; general: string }>();
  const byKey = (k: string) => [...accounts.values()].find((a) => a.apiKey === k);
  const asaas = { seq: 0, createCalls: 0, bodies: [] as any[], createDelayMs: 0, createFail: 0 as 0 | 403 | 503 | 400, statusFail: 0 as 0 | 401 | 503 };
  const install = () =>
    jest.spyOn(axios, 'request').mockImplementation(async (cfg: any) => {
      const path = String(cfg.url).replace(/^https:\/\/api-sandbox\.asaas\.com\/v3/, '');
      const res = (status: number, data: any) => ({ status, data }) as any;
      const key = cfg.headers.access_token as string;
      if (path === '/accounts' && cfg.method === 'post') {
        expect(key).toBe('chave-plataforma-teste'); // criar subconta usa a conta da plataforma
        asaas.createCalls++;
        asaas.bodies.push(cfg.data);
        if (asaas.createDelayMs) await new Promise((r) => setTimeout(r, asaas.createDelayMs));
        if (asaas.createFail === 403) return res(403, { message: 'Contas de pessoa física (CPF) não podem criar subcontas no Asaas.' });
        if (asaas.createFail === 400) return res(400, { errors: [{ description: 'CEP inválido' }] });
        if (asaas.createFail === 503) return res(503, {});
        const n = ++asaas.seq;
        const acc = { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, walletId: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`, apiKey: `$aact_hmlg_teste_${n}_${'x'.repeat(30)}`, general: 'PENDING' };
        accounts.set(acc.id, acc);
        return res(200, { object: 'account', id: acc.id, walletId: acc.walletId, cpfCnpj: cfg.data.cpfCnpj, accessToken: { apiKey: acc.apiKey } });
      }
      if (path === '/myAccount/status') {
        if (asaas.statusFail === 503) return res(503, {});
        if (asaas.statusFail === 401) return res(401, { errors: [{ description: 'Chave inválida' }] });
        const acc = byKey(key);
        if (!acc) return res(401, { errors: [{ description: 'Chave inválida' }] });
        return res(200, { general: acc.general, commercialInfo: acc.general, bankAccountInfo: acc.general, documentation: acc.general });
      }
      const approve = path.match(/^\/accounts\/([^/]+)\/approve$/);
      if (approve) {
        expect(key).toBe('chave-plataforma-teste');
        const acc = accounts.get(approve[1]);
        if (!acc) return res(404, {});
        acc.general = 'APPROVED';
        return res(200, {});
      }
      throw new Error(`Chamada inesperada ao Asaas: ${cfg.method} ${path}`);
    });

  const cnpjs = ['11222333000181', '45723174000110'];
  const ongData = (n: number) => ({ cnpj: cnpjs[n], legalName: `Associação Teste ${n} Ltda`, tradeName: `Ong Teste ${n}`, email: `ong${n}@example.invalid`, phone: '11988887777', zip: '01310100', street: 'Avenida Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP' });

  beforeAll(async () => {
    await migrateSchema(schema);
    bootstrap = await migratorConn().initialize();
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), TypeOrmModule.forRoot({ ...runtimeOptions(schema), entities: ENTITIES }), PaymentsModule, UsersModule, AuditModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    db = app.get(DataSource);
    svc = app.get(PaymentAccountsService);
    const users = db.getRepository(User);
    const mk = (name: string, type: UserType) => users.save(users.create({ name, email: `${name}@example.invalid`, password: 'nao-utilizada', type, status: UserStatus.ATIVO, phone: '11999999999', city: 'São Paulo' }));
    const jwt = app.get(JwtService);
    const sign = async (u: User) => {
      const s = await db.getRepository(Session).save({ userId: u.id, mfaVerified: true, expiresAt: new Date(Date.now() + 3600_000) });
      return jwt.sign({ sub: u.id, email: u.email, type: u.type, sid: s.id });
    };
    userA = await mk('ongA', UserType.ONG);
    userB = await mk('ongB', UserType.ONG);
    adminToken = await sign(await mk('admin', UserType.ADMIN));
    doadorToken = await sign(await mk('doador', UserType.DOADOR));
    tokenA = await sign(userA);
    tokenB = await sign(userB);
    const orgs = db.getRepository(Organization);
    orgA = await orgs.save(orgs.create({ ownerId: userA.id, ...ongData(0), status: OrganizationStatus.APROVADA }));
    orgB = await orgs.save(orgs.create({ ownerId: userB.id, ...ongData(1), status: OrganizationStatus.APROVADA }));
  });

  beforeEach(() => {
    install();
    asaas.createFail = 0;
    asaas.statusFail = 0;
    asaas.createDelayMs = 0;
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    await bootstrap?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await bootstrap?.destroy();
  });

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const criar = (orgId: string, income: any = 8000, token = adminToken) => http().post(`/admin/payment-accounts/${orgId}`).set('Authorization', `Bearer ${token}`).send({ incomeValue: income });
  const row = (orgId: string) => db.getRepository(OrganizationPaymentAccount).findOne({ where: { organizationId: orgId }, select: { id: true, organizationId: true, status: true, environment: true, providerAccountId: true, walletId: true, apiKeyEnc: true, statusDetail: true, providerStatus: true } });

  describe('pré-condições', () => {
    it('só administradores operam; ONG e doador recebem 403, sem token 401', async () => {
      await criar(orgA.id, 8000, tokenA).expect(403);
      await criar(orgA.id, 8000, doadorToken).expect(403);
      await http().post(`/admin/payment-accounts/${orgA.id}`).send({ incomeValue: 1000 }).expect(401);
      await http().get(`/admin/payment-accounts/${orgA.id}`).set('Authorization', `Bearer ${tokenB}`).expect(403);
      expect(asaas.createCalls).toBe(0);
    });

    it('valida o faturamento informado e o id da organização', async () => {
      await criar(orgA.id, 0).expect(400);
      await criar(orgA.id, 'muito').expect(400);
      await http().post('/admin/payment-accounts/nao-e-uuid').set(admin()).send({ incomeValue: 1000 }).expect(400);
      await criar('00000000-0000-4000-8000-0000000000ff').expect(404);
      expect(asaas.createCalls).toBe(0);
    });

    it('ONG ainda não aprovada não ganha conta de recebimento', async () => {
      const orgs = db.getRepository(Organization);
      await orgs.update(orgA.id, { status: OrganizationStatus.EM_ANALISE });
      await criar(orgA.id).expect(409);
      await orgs.update(orgA.id, { status: OrganizationStatus.SUSPENSA });
      await criar(orgA.id).expect(409);
      await orgs.update(orgA.id, { status: OrganizationStatus.APROVADA });
      expect(asaas.createCalls).toBe(0);
      expect(await row(orgA.id)).toBeNull();
    });

    it('cadastro incompleto: lista o que falta e não chama o provedor nem cria linha', async () => {
      const orgs = db.getRepository(Organization);
      await orgs.update(orgA.id, { phone: null, zip: '123' });
      const r = await criar(orgA.id).expect(422);
      expect(r.body.missing).toEqual(expect.arrayContaining(['telefone celular', 'CEP']));
      await orgs.update(orgA.id, { phone: '11988887777', zip: '01310100' });
      expect(asaas.createCalls).toBe(0);
      expect(await row(orgA.id)).toBeNull();
    });
  });

  describe('falhas do provedor: nada de plano B na conta da plataforma', () => {
    it('conta da plataforma pessoa física (403): fica FALHA, mensagem ao admin, ONG não recebe doação', async () => {
      asaas.createFail = 403;
      const r = await criar(orgA.id).expect(502);
      expect(JSON.stringify(r.body)).not.toContain('chave-plataforma');
      const falha = await row(orgA.id);
      expect(falha?.status).toBe(PaymentAccountStatus.FALHA);
      expect(falha?.statusDetail).toContain('pessoa física');
      expect(falha?.providerAccountId).toBeNull();
      expect(falha?.apiKeyEnc).toBeNull();
      await expect(svc.credentialsFor(orgA.id)).rejects.toThrow(/não pode receber doações/);
      expect(await svc.canReceive(orgA.id)).toBe(false);
    });

    it('depois da falha sem efeito no provedor, o admin pode tentar de novo (e só uma tentativa vence)', async () => {
      asaas.createDelayMs = 150;
      const antes = asaas.createCalls;
      const [x, y] = await Promise.all([criar(orgA.id), criar(orgA.id)]);
      expect([x.status, y.status].sort()).toEqual([201, 409]);
      expect(asaas.createCalls - antes).toBe(1);
      const ok = await row(orgA.id);
      expect(ok?.status).toBe(PaymentAccountStatus.AGUARDANDO_APROVACAO);
      expect(ok?.providerAccountId).toBeTruthy();
    });

    it('erro 400 e indisponibilidade (503) também terminam em FALHA sem credencial', async () => {
      for (const code of [400, 503] as const) {
        const org = await db.getRepository(Organization).save(db.getRepository(Organization).create({ ownerId: (await db.getRepository(User).save(db.getRepository(User).create({ name: `x${code}`, email: `x${code}@example.invalid`, password: 'n', type: UserType.ONG, status: UserStatus.ATIVO }))).id, ...ongData(0), cnpj: code === 400 ? '19131243000197' : '27865757000102', status: OrganizationStatus.APROVADA }));
        asaas.createFail = code;
        await criar(org.id).expect(502);
        const r = await row(org.id);
        expect(r?.status).toBe(PaymentAccountStatus.FALHA);
        expect(r?.apiKeyEnc).toBeNull();
        asaas.createFail = 0;
      }
    });
  });

  describe('criação para duas ONGs', () => {
    it('cada ONG ganha uma subconta própria, sem chave na resposta, e a repetição é recusada', async () => {
      const chamadasA = asaas.createCalls;
      const b = await criar(orgB.id).expect(201);
      const a = await row(orgA.id);
      const bRow = await row(orgB.id);
      expect(asaas.createCalls - chamadasA).toBe(1);
      expect(a?.providerAccountId).not.toBe(bRow?.providerAccountId);
      expect(a?.walletId).not.toBe(bRow?.walletId);
      expect(b.body.status).toBe('AGUARDANDO_APROVACAO');
      expect(JSON.stringify(b.body)).not.toMatch(/aact_|apiKey|accessToken/);
      // dados enviados ao provedor vieram da ONG correta (CNPJ de B), não de A
      const enviado = asaas.bodies[asaas.bodies.length - 1];
      expect(enviado.cpfCnpj).toBe(cnpjs[1]);
      expect(enviado.companyType).toBe('ASSOCIATION');
      expect(enviado.incomeValue).toBe(8000);
      // repetir não cria segunda conta
      await criar(orgB.id).expect(409);
      await criar(orgA.id).expect(409);
      expect(asaas.createCalls - chamadasA).toBe(1);
    });

    it('a chave de API fica cifrada no banco, amarrada à ONG dona', async () => {
      const a = await row(orgA.id);
      const b = await row(orgB.id);
      const chaveA = [...accounts.values()].find((x) => x.id === a?.providerAccountId)!.apiKey;
      expect(a?.apiKeyEnc).toBeTruthy();
      expect(a?.apiKeyEnc).not.toContain('aact');
      expect(openSecret(a!.apiKeyEnc!, `payment-account:${orgA.id}`)).toBe(chaveA);
      expect(() => openSecret(a!.apiKeyEnc!, `payment-account:${orgB.id}`)).toThrow();
      // ciphertext de A colado na linha de B não abre em nome de B
      await db.query(`UPDATE "${schema}"."organization_payment_accounts" SET "status"='ATIVA', "apiKeyEnc"=$1 WHERE "organizationId"=$2`, [a!.apiKeyEnc, orgB.id]);
      await expect(svc.credentialsFor(orgB.id)).rejects.toThrow(/credencial de recebimento inválida/);
      await db.query(`UPDATE "${schema}"."organization_payment_accounts" SET "status"='AGUARDANDO_APROVACAO', "apiKeyEnc"=$1 WHERE "organizationId"=$2`, [b!.apiKeyEnc, orgB.id]);
    });

    it('um provedor devolvendo a mesma subconta para duas ONGs é barrado pelo banco (id/carteira únicos)', async () => {
      const a = await row(orgA.id);
      await expect(db.query(`UPDATE "${schema}"."organization_payment_accounts" SET "walletId"=$1 WHERE "organizationId"=$2`, [a!.walletId, orgB.id])).rejects.toThrow(/duplicate|unique|único/i);
    });
  });

  describe('situação cadastral e liberação para doações', () => {
    it('enquanto o provedor analisa, a ONG não recebe doações', async () => {
      await http().post(`/admin/payment-accounts/${orgA.id}/refresh`).set(admin()).expect(201);
      const r = await http().get(`/admin/payment-accounts/${orgA.id}`).set(admin()).expect(200);
      expect(r.body.status).toBe('AGUARDANDO_APROVACAO');
      expect(r.body.providerStatus.general).toBe('PENDING');
      await expect(svc.credentialsFor(orgA.id)).rejects.toThrow(/não pode receber doações/);
      expect(await svc.canReceive(orgA.id)).toBe(false);
    });

    it('falha de rede ao consultar o status não altera nada', async () => {
      asaas.statusFail = 503;
      await http().post(`/admin/payment-accounts/${orgA.id}/refresh`).set(admin()).expect(502);
      expect((await row(orgA.id))?.status).toBe(PaymentAccountStatus.AGUARDANDO_APROVACAO);
    });

    it('aprovada pelo provedor: fica ATIVA e a credencial só sai para a ONG certa', async () => {
      const a = await row(orgA.id);
      accounts.get(a!.providerAccountId!)!.general = 'APPROVED';
      const r = await http().post(`/admin/payment-accounts/${orgA.id}/refresh`).set(admin()).expect(201);
      expect(r.body.status).toBe('ATIVA');
      expect(r.body.approvedAt).toBeTruthy();
      const cred = await svc.credentialsFor(orgA.id);
      expect(cred.walletId).toBe(a!.walletId);
      expect(cred.apiKey).toBe(accounts.get(a!.providerAccountId!)!.apiKey);
      // B continua sem poder receber
      await expect(svc.credentialsFor(orgB.id)).rejects.toThrow(/não pode receber doações/);
    });

    it('credencial de outro ambiente nunca é usada', async () => {
      await db.query(`UPDATE "${schema}"."organization_payment_accounts" SET "environment"='production' WHERE "organizationId"=$1`, [orgA.id]);
      await expect(svc.credentialsFor(orgA.id)).rejects.toThrow(/não pode receber doações/);
      expect(await svc.canReceive(orgA.id)).toBe(false);
      await db.query(`UPDATE "${schema}"."organization_payment_accounts" SET "environment"='sandbox' WHERE "organizationId"=$1`, [orgA.id]);
      expect(await svc.canReceive(orgA.id)).toBe(true);
    });

    it('provedor recusando a credencial: BLOQUEADA, e deixa de poder receber', async () => {
      asaas.statusFail = 401;
      const r = await http().post(`/admin/payment-accounts/${orgA.id}/refresh`).set(admin()).expect(201);
      expect(r.body.status).toBe('BLOQUEADA');
      await expect(svc.credentialsFor(orgA.id)).rejects.toThrow(/não pode receber doações/);
    });

    it('rejeitada pelo provedor: REJEITADA, com motivo para o admin', async () => {
      const b = await row(orgB.id);
      accounts.get(b!.providerAccountId!)!.general = 'REJECTED';
      const r = await http().post(`/admin/payment-accounts/${orgB.id}/refresh`).set(admin()).expect(201);
      expect(r.body.status).toBe('REJEITADA');
      expect(r.body.statusDetail).toMatch(/rejeitou/);
      await expect(svc.credentialsFor(orgB.id)).rejects.toThrow(/não pode receber doações/);
    });

    it('aprovação manual do Sandbox pede ao Asaas e relê o status real; em produção é proibida', async () => {
      const b = await row(orgB.id);
      accounts.get(b!.providerAccountId!)!.general = 'PENDING';
      await db.getRepository(OrganizationPaymentAccount).update({ organizationId: orgB.id }, { status: PaymentAccountStatus.AGUARDANDO_APROVACAO });
      process.env.ASAAS_ENV = 'production';
      await http().post(`/admin/payment-accounts/${orgB.id}/sandbox-approve`).set(admin()).expect(403);
      process.env.ASAAS_ENV = 'sandbox';
      const r = await http().post(`/admin/payment-accounts/${orgB.id}/sandbox-approve`).set(admin()).expect(201);
      expect(r.body.status).toBe('ATIVA');
    });

    it('sem conta, refresh devolve 404', async () => {
      const u = await db.getRepository(User).save(db.getRepository(User).create({ name: 'semconta', email: 'semconta@example.invalid', password: 'n', type: UserType.ONG, status: UserStatus.ATIVO }));
      const org = await db.getRepository(Organization).save(db.getRepository(Organization).create({ ownerId: u.id, ...ongData(0), cnpj: '34028316000103', status: OrganizationStatus.APROVADA }));
      await http().post(`/admin/payment-accounts/${org.id}/refresh`).set(admin()).expect(404);
    });
  });

  describe('visão da ONG e isolamento', () => {
    it('cada ONG vê só a própria situação, sem identificadores do provedor', async () => {
      const a = await http().get('/payment-accounts/me').set('Authorization', `Bearer ${tokenA}`).expect(200);
      const b = await http().get('/payment-accounts/me').set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(a.body.status).toBe('BLOQUEADA'); // estado deixado pelo teste anterior
      expect(b.body.status).toBe('ATIVA');
      expect(b.body.canReceiveDonations).toBe(true);
      expect(a.body.canReceiveDonations).toBe(false);
      for (const body of [a.body, b.body]) {
        expect(Object.keys(body).sort()).toEqual(['canReceiveDonations', 'message', 'status']);
      }
      const ra = await row(orgA.id);
      const rb = await row(orgB.id);
      const texto = JSON.stringify([a.body, b.body]);
      for (const secreto of [ra!.walletId!, rb!.walletId!, ra!.providerAccountId!, rb!.providerAccountId!]) expect(texto).not.toContain(secreto);
    });

    it('doador e visitante não consultam; ONG não alcança rotas do administrador', async () => {
      await http().get('/payment-accounts/me').set('Authorization', `Bearer ${doadorToken}`).expect(403);
      await http().get('/payment-accounts/me').expect(401);
      await http().get(`/admin/payment-accounts/${orgB.id}`).set('Authorization', `Bearer ${tokenA}`).expect(403);
      await http().post(`/admin/payment-accounts/${orgB.id}/refresh`).set('Authorization', `Bearer ${tokenA}`).expect(403);
    });

    it('a visão do administrador mostra só o final da carteira e nunca a chave', async () => {
      const r = await http().get(`/admin/payment-accounts/${orgB.id}`).set(admin()).expect(200);
      expect(r.body.walletIdTail).toHaveLength(6);
      expect(JSON.stringify(r.body)).not.toMatch(/aact_|apiKey|accessToken|apiKeyEnc/);
    });
  });

  describe('auditoria', () => {
    it('registra criação, falha e mudanças de status, sem credenciais', async () => {
      const logs = await db.getRepository(AuditLog).find();
      const acoes = logs.map((l) => l.action);
      expect(acoes).toEqual(expect.arrayContaining(['PAYMENT_ACCOUNT_CREATED', 'PAYMENT_ACCOUNT_FAILED', 'PAYMENT_ACCOUNT_STATUS_CHANGED', 'PAYMENT_ACCOUNT_SANDBOX_APPROVAL_REQUESTED']));
      const tudo = JSON.stringify(logs.map((l) => l.metadata));
      expect(tudo).not.toMatch(/aact_|chave-plataforma|apiKey/);
      const criado = logs.find((l) => l.action === 'PAYMENT_ACCOUNT_CREATED' && l.organizationId === orgB.id);
      expect(criado?.actorType).toBe('ADMIN');
    });
  });
});
