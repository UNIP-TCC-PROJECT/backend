import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { unlink } from 'node:fs/promises';
import axios from 'axios';
import { AccountabilityModule } from '../src/accountability/accountability.module';
import { DeliveryEvidence, DeliveryRecord } from '../src/accountability/entities/delivery.entity';
import { Expense, ExpenseDocument } from '../src/accountability/entities/expense.entity';
import { DeliveryEvidence as Ev } from '../src/accountability/entities/delivery.entity';
import { AuditLog } from '../src/audit/audit-log.entity';
import { AuditModule } from '../src/audit/audit.module';
import { Session } from '../src/auth/entities/session.entity';
import { totpAt } from '../src/auth/totp';
import { CampaignsModule } from '../src/campaigns/campaigns.module';
import { Campaign } from '../src/campaigns/entities/campaign.entity';
import { PaymentEvent } from '../src/payments/payment-event.entity';
import { PaymentsModule } from '../src/payments/payments.module';
import { DonationsModule } from '../src/donations/donations.module';
import { Donation } from '../src/donations/entities/donation.entity';
import { OrganizationDocument } from '../src/organizations/entities/organization-document.entity';
import { OrganizationExternalCheck } from '../src/organizations/entities/organization-external-check.entity';
import { OrganizationValidation } from '../src/organizations/entities/organization-validation.entity';
import { Organization } from '../src/organizations/entities/organization.entity';
import { OrganizationsModule } from '../src/organizations/organizations.module';
import { User, UserType } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { Medalha } from '../src/medalhas/entities/medalha.entity';
import { DocumentoMedalhaBranca, PedidoMedalhaBranca } from '../src/medalhas/entities/pedido-medalha-branca.entity';
import { MedalhasModule } from '../src/medalhas/medalhas.module';

// Banco real em schema temporário.
// Execute: node node_modules/jest/bin/jest.js --config test/jest-plataforma.json --runInBand
describe('Plataforma — RBAC, isolamento entre ONGs, sessões e auditoria (PostgreSQL)', () => {
  jest.setTimeout(60000);
  process.env.JWT_SECRET ??= 'e2e-secret';
  const schema = `teste_plataforma_${process.pid}_${Date.now()}`;
  const options = {
    type: 'postgres' as const,
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'tcc_db',
  };
  const SENHA = 'Senha@12345';
  let bootstrap: DataSource;
  let db: DataSource;
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  const login = (email: string, otp?: string) => http().post('/users/login').send({ email, password: SENHA, otp });
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
  // Fontes externas simuladas (o teste não depende de rede). brasil: 'ok' | 'down' | 'divergente'.
  let brasil: 'ok' | 'down' | 'divergente' = 'ok';
  let portalAlerta = false;
  const receita = (cnpj: string, razao: string) => ({ cnpj, razao_social: razao, nome_fantasia: razao, situacao_cadastral: 2, descricao_situacao_cadastral: 'ATIVA', natureza_juridica: 'Associação Privada', cnae_fiscal: 9430800, cnaes_secundarios: [], cep: '01310100', uf: 'SP', municipio: 'SAO PAULO' });
  beforeEach(() => {
    jest.spyOn(axios, 'get').mockImplementation(async (url: string, cfg?: any) => {
      const res = (status: number, data: any) => ({ status, data }) as any;
      if (url.includes('brasilapi')) {
        if (brasil === 'down') return res(503, 'down');
        const cnpj = url.split('/').pop()!;
        return res(200, receita(cnpj, brasil === 'divergente' ? 'OUTRA EMPRESA LTDA' : `ONG ${cnpj}`));
      }
      if (url.includes('mapaosc')) return res(404, '<html>');
      if (url.includes('portaldatransparencia')) return res(200, portalAlerta && url.endsWith('/ceis') ? [{ id: 1 }] : []);
      if (url.includes('transferegov')) return res(200, { data: [], total_items: 0 });
      throw new Error(`URL externa inesperada: ${url}`);
    });
    process.env.PORTAL_TRANSPARENCIA_API_KEY = 'chave-teste';
  });
  afterEach(() => jest.restoreAllMocks());

  // Asaas simulado em memória: o teste controla o "status real" de cada cobrança.
  const WEBHOOK_TOKEN = 'w'.repeat(40);
  const asaas = { payments: new Map<string, any>(), seq: 0, failCreate: false, created: 0 };
  const installAsaas = () => {
    process.env.ASAAS_API_KEY = 'chave-sandbox-teste';
    process.env.ASAAS_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
    jest.spyOn(axios, 'request').mockImplementation(async (cfg: any) => {
      const path = String(cfg.url).replace(/^https:\/\/api-sandbox\.asaas\.com\/v3/, '');
      expect(cfg.headers.access_token).toBe('chave-sandbox-teste');
      const res = (status: number, data: any) => ({ status, data }) as any;
      if (path === '/customers') return res(200, { id: `cus_${++asaas.seq}` });
      if (path === '/payments' && cfg.method === 'post') {
        if (asaas.failCreate) return res(503, {});
        const id = `pay_${++asaas.seq}`;
        asaas.created++;
        asaas.payments.set(id, { id, status: 'PENDING', value: cfg.data.value, billingType: cfg.data.billingType, externalReference: cfg.data.externalReference });
        return res(200, asaas.payments.get(id));
      }
      const m = path.match(/^\/payments\/([\w]+)(\/pixQrCode)?$/);
      const pay = m && asaas.payments.get(m[1]);
      if (!pay) return res(404, {});
      return res(200, m![2] ? { encodedImage: 'iVBORw0KGgo=', payload: `000201PIX${pay.id}`, expirationDate: '2099-01-01 23:59:59' } : pay);
    });
  };
  beforeEach(installAsaas);
  const evtSeq = { n: 0 };
  const webhook = (paymentId: string, event = 'PAYMENT_RECEIVED', id = `evt_${++evtSeq.n}`, token: string | null = WEBHOOK_TOKEN) => {
    const r = http().post('/webhooks/asaas').send({ id, event, dateCreated: '2026-01-01 10:00:00', payment: { id: paymentId } });
    return token ? r.set('asaas-access-token', token) : r;
  };
  const providerId = async (donationId: string) => (await db.getRepository(Donation).findOneByOrFail({ id: donationId })).providerPaymentId!;
  const dataOK = { startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 30 * 86400_000).toISOString(), objective: 'Garantir alimentação das famílias atendidas.' };

  const dados = (cnpj: string) => ({ legalName: `ONG ${cnpj}`, tradeName: `ONG ${cnpj}`, description: 'Atendimento a famílias em vulnerabilidade social.', email: 'contato@ong.org', phone: '(11) 3333-4444', zip: '01310-100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'sp', legalRepName: 'Maria da Silva', legalRepCpf: '529.982.247-25', legalRepRole: 'Presidente', legalRepEmail: 'maria@ong.org', legalRepPhone: '11999998888' });
  const TIPOS = ['ESTATUTO', 'ATA_DIRETORIA', 'COMPROVANTE_ENDERECO', 'DOC_REPRESENTANTE'];
  const enviarTudo = async (tok: string, cnpj: string) => {
    await http().patch('/organizations/me').auth(tok, { type: 'bearer' }).send(dados(cnpj)).expect(200);
    for (const t of TIPOS) await http().post('/organizations/me/documents').auth(tok, { type: 'bearer' }).field('type', t).attach('file', pdf, { filename: `${t}.pdf`, contentType: 'application/pdf' }).expect(201);
  };
  const aprovar = async (org: string, body: any = { decision: 'APROVAR' }) => {
    for (const d of (await http().get(`/admin/organizations/${org}`).auth(tokAdmin, { type: 'bearer' })).body.documents.filter((x: any) => x.status === 'PENDENTE' && !x.supersededAt)) {
      await http().post(`/admin/organizations/documents/${d.id}/review`).auth(tokAdmin, { type: 'bearer' }).send({ decision: 'APROVAR' }).expect(201);
    }
    return http().post(`/admin/organizations/${org}/decision`).auth(tokAdmin, { type: 'bearer' }).send(body);
  };
  let tokDoador2: string;
  let tokA: string, tokB: string, tokDoador: string, tokAdmin: string;
  let orgA: string, orgB: string, campA: string, expA: string, docA: string;

  async function criar(email: string, type: UserType, extra: Partial<User> = {}) {
    return db.getRepository(User).save(
      db.getRepository(User).create({ name: email.split('@')[0], email, password: await bcrypt.hash(SENHA, 4), type, ...extra }),
    );
  }

  beforeAll(async () => {
    bootstrap = await new DataSource(options).initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...options, schema, synchronize: true,
          entities: [User, Session, AuditLog, Organization, OrganizationDocument, OrganizationValidation, OrganizationExternalCheck, Campaign, Donation, PaymentEvent, Expense, ExpenseDocument, DeliveryRecord, DeliveryEvidence, Medalha, PedidoMedalhaBranca, DocumentoMedalhaBranca],
        }),
        AuditModule, UsersModule, OrganizationsModule, CampaignsModule, DonationsModule, PaymentsModule, AccountabilityModule, MedalhasModule,
      ],
    })
      // O limite por IP (429) é coberto à parte; aqui o foco é o bloqueio por conta.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    db = app.get(DataSource);

    await criar('ongA@example.invalid', UserType.ONG, { cnpj: '11222333000181' });
    await criar('ongB@example.invalid', UserType.ONG, { cnpj: '45723174000110' });
    await criar('doador@example.invalid', UserType.DOADOR, { cpf: '52998224725' });
    await criar('doador2@example.invalid', UserType.DOADOR);
    await criar('admin@example.invalid', UserType.ADMIN);
    tokA = (await login('ongA@example.invalid')).body.access_token;
    tokB = (await login('ongB@example.invalid')).body.access_token;
    tokDoador = (await login('doador@example.invalid')).body.access_token;
    tokDoador2 = (await login('doador2@example.invalid')).body.access_token;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (bootstrap?.isInitialized) {
      if (!/^teste_plataforma_\d+_\d+$/.test(schema)) throw new Error('Schema de teste inválido');
      await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);
      await bootstrap.destroy();
    }
  });

  describe('administrador e MFA', () => {
    let secret: string;
    it('admin sem MFA entra, mas só alcança o enrolamento', async () => {
      const r = await login('admin@example.invalid');
      expect(r.body.mfa_setup_required).toBe(true);
      tokAdmin = r.body.access_token;
      await http().get('/admin/organizations').auth(tokAdmin, { type: 'bearer' }).expect(403);
      secret = (await http().post('/auth/mfa/setup').auth(tokAdmin, { type: 'bearer' }).expect(201)).body.secret;
    });
    it('código errado não ativa; código correto ativa e libera a sessão', async () => {
      await http().post('/auth/mfa/enable').auth(tokAdmin, { type: 'bearer' }).send({ code: '000000' }).expect(401);
      await http().post('/auth/mfa/enable').auth(tokAdmin, { type: 'bearer' }).send({ code: totpAt(secret, Date.now()) }).expect(201);
      await http().get('/admin/organizations').auth(tokAdmin, { type: 'bearer' }).expect(200);
    });
    it('novo login de admin exige o código', async () => {
      const r = await login('admin@example.invalid').expect(401);
      expect(r.body.mfaRequired).toBe(true);
      tokAdmin = (await login('admin@example.invalid', totpAt(secret, Date.now())).expect(201)).body.access_token;
    });
  });

  describe('RBAC', () => {
    it('doador e ONG não acessam rotas administrativas', async () => {
      for (const t of [tokDoador, tokA]) {
        await http().get('/admin/organizations').auth(t, { type: 'bearer' }).expect(403);
        await http().get('/admin/audit-logs').auth(t, { type: 'bearer' }).expect(403);
      }
    });
    it('sem token → 401; doador não cria campanha nem opera prestação de contas', async () => {
      await http().get('/my/campaigns').expect(401);
      await http().post('/my/campaigns').auth(tokDoador, { type: 'bearer' }).send({}).expect(403);
      await http().get('/my/expenses').auth(tokDoador, { type: 'bearer' }).expect(403);
    });
    it('ONG não doa', async () => {
      await http().get('/my/donations').auth(tokA, { type: 'bearer' }).expect(403);
    });
  });

  describe('validação institucional', () => {
    it('ONG não aprovada não cria campanha', async () => {
      orgA = (await http().get('/organizations/me').auth(tokA, { type: 'bearer' }).expect(200)).body.id;
      orgB = (await http().get('/organizations/me').auth(tokB, { type: 'bearer' }).expect(200)).body.id;
      await http().post('/my/campaigns').auth(tokA, { type: 'bearer' }).send({ title: 'Campanha X', description: 'Descrição longa o bastante.', goalCents: 100000, ...dataOK }).expect(403);
    });
    it('rejeita arquivo com conteúdo falso (extensão/MIME de PDF, bytes diferentes)', async () => {
      await http().post('/organizations/me/documents').auth(tokA, { type: 'bearer' }).field('type', 'ESTATUTO')
        .attach('file', Buffer.from('MZ-executavel'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400);
    });
    it('envia cadastro e documentos, passa pelas consultas e admin aprova (com justificativa só quando há bloqueio)', async () => {
      for (const [t, c] of [[tokA, '11222333000181'], [tokB, '45723174000110']] as const) {
        await enviarTudo(t, c);
        await http().post('/organizations/me/submit').auth(t, { type: 'bearer' }).expect(201);
      }
      docA = (await http().get(`/admin/organizations/${orgA}`).auth(tokAdmin, { type: 'bearer' })).body.documents[0].id;
      for (const org of [orgA, orgB]) await aprovar(org).then((r) => expect(r.status).toBe(201));
    });
    it('reprovação exige motivo', async () => {
      await http().post(`/admin/organizations/${orgA}/decision`).auth(tokAdmin, { type: 'bearer' }).send({ decision: 'REPROVAR' }).expect(400);
    });
  });

  describe('cadastro e validação institucional (ONG C)', () => {
    let tokC: string, orgC: string;
    beforeAll(async () => {
      await criar('ongC@example.invalid', UserType.ONG, { cnpj: '04.252.011/0001-10' });
      tokC = (await login('ongC@example.invalid')).body.access_token;
      orgC = (await http().get('/organizations/me').auth(tokC, { type: 'bearer' })).body.id;
    });
    const admin = (m: 'get' | 'post', url: string) => (http() as any)[m](url).auth(tokAdmin, { type: 'bearer' });

    it('começa INCOMPLETO e não envia sem os dados e documentos obrigatórios', async () => {
      const me = (await http().get('/organizations/me').auth(tokC, { type: 'bearer' })).body;
      expect(me.status).toBe('INCOMPLETO');
      const r = await http().post('/organizations/me/submit').auth(tokC, { type: 'bearer' }).expect(400);
      expect(r.body.missing.documents).toEqual(expect.arrayContaining(TIPOS));
      expect(r.body.missing.fields).toContain('Nome do representante legal');
    });
    it('valida CPF/telefone no servidor e normaliza os dados', async () => {
      await http().patch('/organizations/me').auth(tokC, { type: 'bearer' }).send({ legalRepCpf: '111.111.111-11' }).expect(400);
      await http().patch('/organizations/me').auth(tokC, { type: 'bearer' }).send({ phone: '123' }).expect(400);
      const o = (await http().patch('/organizations/me').auth(tokC, { type: 'bearer' }).send(dados('04252011000110')).expect(200)).body;
      expect(o).toMatchObject({ zip: '01310100', phone: '1133334444', state: 'SP', legalRepCpf: '52998224725' });
    });
    it('BrasilAPI fora do ar: fica EM_ANALISE (pendente) e a aprovação é bloqueada sem justificativa', async () => {
      brasil = 'down';
      for (const t of TIPOS) await http().post('/organizations/me/documents').auth(tokC, { type: 'bearer' }).field('type', t).attach('file', pdf, { filename: `${t}.pdf`, contentType: 'application/pdf' }).expect(201);
      await http().post('/organizations/me/submit').auth(tokC, { type: 'bearer' }).expect(201);
      const det = (await admin('get', `/admin/organizations/${orgC}`)).body;
      expect(det.status).toBe('EM_ANALISE');
      const b = det.externalChecks.find((c: any) => c.source === 'BRASILAPI');
      expect(b).toMatchObject({ status: 'INDISPONIVEL', httpStatus: 503 });
      expect(b.queriedAt).toBeDefined();
      expect(det.externalChecks.map((c: any) => c.source).sort()).toEqual(['BRASILAPI', 'MAPA_OSC', 'PORTAL_TRANSPARENCIA', 'TRANSFEREGOV']);
      expect(det.externalChecks.find((c: any) => c.source === 'MAPA_OSC').status).toBe('NAO_ENCONTRADO');
      const r = await aprovar(orgC);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/BRASILAPI/);
      expect((await admin('get', `/admin/organizations/${orgC}`)).body.status).toBe('EM_ANALISE');
    });
    it('ONG em análise não aparece na vitrine pública e não pode alterar cadastro/documentos', async () => {
      expect((await http().get('/organizations/public')).body.map((o: any) => o.id)).not.toContain(orgC);
      await http().get(`/organizations/public/${orgC}`).expect(404);
      await http().patch('/organizations/me').auth(tokC, { type: 'bearer' }).send({ tradeName: 'Nova' }).expect(400);
      await http().post('/organizations/me/documents').auth(tokC, { type: 'bearer' }).field('type', 'OUTRO').attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400);
    });
    it('reexecutar consultas registra novo histórico com fonte e data; divergência vira ALERTA', async () => {
      brasil = 'divergente';
      await admin('post', `/admin/organizations/${orgC}/checks/run`).expect(201);
      const det = (await admin('get', `/admin/organizations/${orgC}`)).body;
      expect(det.externalCheckHistory.length).toBeGreaterThanOrEqual(8);
      const b = det.externalChecks.find((c: any) => c.source === 'BRASILAPI');
      expect(b.status).toBe('ALERTA');
      expect(b.findings.join(' ')).toMatch(/Razão social diverge/);
      const r = await aprovar(orgC);
      expect(r.status).toBe(400);
      expect(r.body.blockers).toEqual(expect.arrayContaining(['alerta em BRASILAPI']));
    });
    it('consulta de sanções com registro vira ALERTA; ONG não acessa o resultado bruto das consultas', async () => {
      brasil = 'ok'; portalAlerta = true;
      await admin('post', `/admin/organizations/${orgC}/checks/run`).expect(201);
      const p = (await admin('get', `/admin/organizations/${orgC}`)).body.externalChecks.find((c: any) => c.source === 'PORTAL_TRANSPARENCIA');
      expect(p.status).toBe('ALERTA');
      const me = (await http().get('/organizations/me').auth(tokC, { type: 'bearer' })).body;
      expect(JSON.stringify(me)).not.toMatch(/findings|Sanç|CEIS/);
      await http().get(`/admin/organizations/${orgC}`).auth(tokC, { type: 'bearer' }).expect(403);
      portalAlerta = false;
    });
    it('admin solicita documentos complementares → AGUARDANDO_DOCUMENTACAO; ONG reenvia', async () => {
      await admin('post', `/admin/organizations/${orgC}/request-documents`).send({ message: 'curto' }).expect(400);
      await admin('post', `/admin/organizations/${orgC}/request-documents`).send({ message: 'Envie a ata atualizada e legível.' }).expect(201);
      const me = (await http().get('/organizations/me').auth(tokC, { type: 'bearer' })).body;
      expect(me).toMatchObject({ status: 'AGUARDANDO_DOCUMENTACAO', statusReason: 'Envie a ata atualizada e legível.' });
      await http().post('/organizations/me/documents').auth(tokC, { type: 'bearer' }).field('type', 'ATA_DIRETORIA').attach('file', pdf, { filename: 'ata2.pdf', contentType: 'application/pdf' }).expect(201);
      await http().post('/organizations/me/submit').auth(tokC, { type: 'bearer' }).expect(201);
    });
    it('aprovação exige todos os documentos analisados e, com consultas OK, dispensa justificativa', async () => {
      const r = await aprovar(orgC);
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('APROVADA');
      const pub = (await http().get('/organizations/public')).body.find((o: any) => o.id === orgC);
      expect(pub).toBeDefined();
      expect(pub).not.toHaveProperty('legalRepCpf');
      expect(pub).not.toHaveProperty('email');
      const hist = (await admin('get', `/admin/organizations/${orgC}`)).body.validations.map((v: any) => v.decision);
      expect(hist).toEqual(expect.arrayContaining(['SOLICITAR_DOCUMENTOS', 'APROVAR']));
    });
    it('ONG ainda não aprovada não publica campanha', async () => {
      await criar('ongD@example.invalid', UserType.ONG, { cnpj: '07526557000100' });
      const tokD = (await login('ongD@example.invalid')).body.access_token;
      await http().post('/my/campaigns').auth(tokD, { type: 'bearer' }).send({ title: 'Campanha D', description: 'Descrição longa o bastante.', goalCents: 100000, ...dataOK }).expect(403);
    });
  });

  describe('isolamento entre ONGs', () => {
    it('ONG A cria campanha, despesa e comprovante; ONG B não os vê nem os manipula', async () => {
      campA = (await http().post('/my/campaigns').auth(tokA, { type: 'bearer' }).send({ title: 'Campanha A', description: 'Descrição longa o bastante.', goalCents: 500000, ...dataOK }).expect(201)).body.id;
      await http().post(`/my/campaigns/${campA}/status`).auth(tokA, { type: 'bearer' }).send({ status: 'ATIVA' }).expect(201);
      expA = (await http().post('/my/expenses').auth(tokA, { type: 'bearer' }).send({ campaignId: campA, description: 'Compra de cestas básicas', category: 'Alimentos', amountCents: 20000, spentAt: '2026-01-10' }).expect(201)).body.id;
      const doc = (await http().post(`/my/expenses/${expA}/documents`).auth(tokA, { type: 'bearer' }).field('kind', 'NOTA_FISCAL').attach('file', pdf, { filename: 'nf.pdf', contentType: 'application/pdf' }).expect(201)).body;
      expect(doc).not.toHaveProperty('content');

      expect((await http().get('/my/campaigns').auth(tokB, { type: 'bearer' })).body).toEqual([]);
      expect((await http().get('/my/expenses').auth(tokB, { type: 'bearer' })).body).toEqual([]);
      await http().get(`/my/campaigns/${campA}`).auth(tokB, { type: 'bearer' }).expect(404);
      await http().patch(`/my/campaigns/${campA}`).auth(tokB, { type: 'bearer' }).send({ title: 'Invadida' }).expect(404);
      await http().post(`/my/campaigns/${campA}/status`).auth(tokB, { type: 'bearer' }).send({ status: 'ENCERRADA' }).expect(404);
      await http().post('/my/expenses').auth(tokB, { type: 'bearer' }).send({ campaignId: campA, description: 'Despesa forjada', category: 'Outros', amountCents: 100, spentAt: '2026-01-10' }).expect(404);
      await http().post(`/my/expenses/${expA}/documents`).auth(tokB, { type: 'bearer' }).field('kind', 'NOTA_FISCAL').attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }).expect(404);
      await http().get(`/expenses/${expA}/documents`).auth(tokB, { type: 'bearer' }).expect(404);
      await http().get(`/expense-documents/${doc.id}/file`).auth(tokB, { type: 'bearer' }).expect(404);
      await http().get(`/organizations/documents/${docA}/file`).auth(tokB, { type: 'bearer' }).expect(404);
      // dono e admin baixam
      await http().get(`/expense-documents/${doc.id}/file`).auth(tokA, { type: 'bearer' }).expect(200);
      await http().get(`/organizations/documents/${docA}/file`).auth(tokAdmin, { type: 'bearer' }).expect(200);
    });
    it('ONG não manipula a própria despesa como se fosse admin', async () => {
      await http().post(`/admin/expenses/${expA}/review`).auth(tokA, { type: 'bearer' }).send({ decision: 'APROVAR' }).expect(403);
    });
    it('doação só entra em campanha ativa; ONG vê apenas as suas, sem dados do doador', async () => {
      const d = (await http().post(`/campaigns/${campA}/donations`).auth(tokDoador, { type: 'bearer' }).send({ amountCents: 5000 }).expect(201)).body;
      expect(d.status).toBe('PENDENTE');
      const a = (await http().get('/my/organization/donations').auth(tokA, { type: 'bearer' })).body;
      expect(a).toHaveLength(1);
      expect(a[0]).not.toHaveProperty('donorId');
      expect((await http().get('/my/organization/donations').auth(tokB, { type: 'bearer' })).body).toEqual([]);
      expect((await http().get('/my/organization/dashboard').auth(tokB, { type: 'bearer' })).body).toMatchObject({ totalRaisedCents: 0, donationsTotal: 0 });
    });
    it('não existe confirmação manual de doação (nem por admin)', async () => {
      const d = (await db.getRepository(Donation).find())[0];
      await http().post(`/admin/donations/${d.id}/confirm`).auth(tokAdmin, { type: 'bearer' }).expect(404);
    });
    it('suspender a ONG derruba suas campanhas da vitrine', async () => {
      await http().post(`/admin/organizations/${orgA}/suspend`).auth(tokAdmin, { type: 'bearer' }).send({ reason: 'Denúncia procedente' }).expect(201);
      expect((await http().get('/campaigns')).body).toHaveLength(0);
      await http().post(`/campaigns/${campA}/donations`).auth(tokDoador, { type: 'bearer' }).send({ amountCents: 5000 }).expect(404);
    });
  });

  describe('Pix (Asaas sandbox simulado) e webhooks', () => {
    let campP: string, tokOngP: string, orgP: string;
    const doar = (cents = 10000, key?: string, tok = tokDoador, body: object = {}) => {
      const r = http().post(`/campaigns/${campP}/donations`).auth(tok, { type: 'bearer' }).send({ amountCents: cents, ...body });
      return key ? r.set('Idempotency-Key', key) : r;
    };
    const raised = async () => (await http().get('/campaigns')).body.find((c: any) => c.id === campP)?.raisedCents ?? 0;
    beforeAll(async () => {
      await criar('ongP@example.invalid', UserType.ONG, { cnpj: '34028316000103' });
      tokOngP = (await login('ongP@example.invalid')).body.access_token;
      orgP = (await http().get('/organizations/me').auth(tokOngP, { type: 'bearer' })).body.id;
      await db.getRepository(Organization).update(orgP, { status: 'APROVADA' as any });
      campP = (await http().post('/my/campaigns').auth(tokOngP, { type: 'bearer' }).send({ title: 'Campanha Pix', description: 'Descrição longa o bastante.', goalCents: 500000, ...dataOK }).expect(201)).body.id;
      await http().post(`/my/campaigns/${campP}/status`).auth(tokOngP, { type: 'bearer' }).send({ status: 'ATIVA' }).expect(201);
    });

    it('cria a cobrança Pix: devolve QR Code e copia-e-cola; doação PENDENTE ligada à campanha e ao doador', async () => {
      const r = (await doar(10000).expect(201)).body;
      expect(r).toMatchObject({ status: 'PENDENTE', amountCents: 10000, campaignId: campP, pix: { payload: expect.stringContaining('000201'), qrCodeBase64: expect.any(String) } });
      expect(r).not.toHaveProperty('providerPaymentId');
      const pay = asaas.payments.get(await providerId(r.id));
      expect(pay).toMatchObject({ value: 100, billingType: 'PIX', externalReference: r.id });
    });
    it('exige CPF válido do doador para emitir o Pix', async () => {
      await doar(10000, undefined, tokDoador2).expect(400);
      await doar(10000, undefined, tokDoador2, { cpf: '111.111.111-11' }).expect(400);
      await doar(10000, undefined, tokDoador2, { cpf: '529.982.247-25' }).expect(201);
    });
    it('chave de idempotência: repetir o POST não cria outra doação nem outra cobrança', async () => {
      const before = asaas.created;
      const a = (await doar(7000, 'chave-unica-0001').expect(201)).body;
      const b = (await doar(7000, 'chave-unica-0001').expect(201)).body;
      expect(b.id).toBe(a.id);
      expect(asaas.created).toBe(before + 1);
    });
    it('falha do provedor: 502 e a doação não fica pendente', async () => {
      asaas.failCreate = true;
      await doar(6000).expect(502);
      asaas.failCreate = false;
      const mine = (await http().get('/my/donations').auth(tokDoador, { type: 'bearer' })).body;
      expect(mine.find((d: any) => d.amountCents === 6000)).toMatchObject({ status: 'CANCELADA' });
    });

    describe('webhook', () => {
      let donation: string, pid: string;
      beforeAll(async () => {
        installAsaas(); // beforeEach não roda antes de beforeAll
        donation = (await doar(20000).expect(201)).body.id;
        pid = await providerId(donation);
      });
      const status = async () => (await db.getRepository(Donation).findOneByOrFail({ id: donation })).status;

      it('rejeita sem token ou com token errado (401) e nada muda', async () => {
        await webhook(pid, 'PAYMENT_RECEIVED', undefined, null).expect(401);
        await webhook(pid, 'PAYMENT_RECEIVED', undefined, 'x'.repeat(40)).expect(401);
        expect(await status()).toBe('PENDENTE');
      });
      it('notificação autêntica, mas o Asaas ainda diz PENDING → não confirma', async () => {
        const r = await webhook(pid).expect(200);
        expect(r.body.outcome).toBe('NO_CHANGE');
        expect(await status()).toBe('PENDENTE');
      });
      it('o usuário "voltar" à plataforma não confirma: sync só reflete o que o Asaas informa', async () => {
        await http().post(`/my/donations/${donation}/sync`).auth(tokDoador, { type: 'bearer' }).expect(201);
        expect(await status()).toBe('PENDENTE');
      });
      it('valor divergente é rejeitado e não confirma', async () => {
        asaas.payments.get(pid).status = 'RECEIVED';
        asaas.payments.get(pid).value = 1;
        expect((await webhook(pid).expect(200)).body.outcome).toBe('REJECTED_MISMATCH');
        expect(await status()).toBe('PENDENTE');
        asaas.payments.get(pid).value = 200;
      });
      it('referência divergente (cobrança de outra doação) é rejeitada', async () => {
        asaas.payments.get(pid).externalReference = 'outra-doacao';
        expect((await webhook(pid).expect(200)).body.outcome).toBe('REJECTED_MISMATCH');
        asaas.payments.get(pid).externalReference = donation;
      });
      it('pagamento real → CONFIRMADA e o total da campanha sobe exatamente uma vez', async () => {
        const antes = await raised();
        expect((await webhook(pid, 'PAYMENT_RECEIVED', 'evt_fixo_1').expect(200)).body.outcome).toBe('APPLIED');
        expect(await status()).toBe('CONFIRMADA');
        expect(await raised()).toBe(antes + 20000);
      });
      it('reenvio do mesmo evento é idempotente (duplicate) e não altera nada', async () => {
        const antes = await raised();
        const confirmedAt = (await db.getRepository(Donation).findOneByOrFail({ id: donation })).confirmedAt;
        expect((await webhook(pid, 'PAYMENT_RECEIVED', 'evt_fixo_1').expect(200)).body.duplicate).toBe(true);
        expect(await db.getRepository(PaymentEvent).countBy({ providerEventId: 'evt_fixo_1' })).toBe(1);
        expect((await db.getRepository(Donation).findOneByOrFail({ id: donation })).confirmedAt).toEqual(confirmedAt);
        expect(await raised()).toBe(antes);
      });
      it('outro evento do mesmo pagamento (CONFIRMED depois de RECEIVED) não duplica o valor', async () => {
        const antes = await raised();
        expect((await webhook(pid, 'PAYMENT_CONFIRMED').expect(200)).body.outcome).toBe('NO_CHANGE');
        expect(await raised()).toBe(antes);
        const logs = await db.getRepository(AuditLog).countBy({ action: 'DONATION_CONFIRMED', entityId: donation });
        expect(logs).toBe(1);
      });
      it('entregas simultâneas do mesmo evento resultam em uma única confirmação', async () => {
        const d2 = (await doar(3000).expect(201)).body.id;
        const p2 = await providerId(d2);
        asaas.payments.get(p2).status = 'RECEIVED';
        await Promise.all([webhook(p2, 'PAYMENT_RECEIVED', 'evt_race'), webhook(p2, 'PAYMENT_RECEIVED', 'evt_race'), webhook(p2, 'PAYMENT_RECEIVED', 'evt_race')]);
        expect(await db.getRepository(AuditLog).countBy({ action: 'DONATION_CONFIRMED', entityId: d2 })).toBe(1);
        expect(await db.getRepository(PaymentEvent).countBy({ providerEventId: 'evt_race' })).toBe(1);
      });
      it('estorno → ESTORNADA e o valor sai do total arrecadado', async () => {
        const antes = await raised();
        asaas.payments.get(pid).status = 'REFUNDED';
        expect((await webhook(pid, 'PAYMENT_REFUNDED').expect(200)).body.outcome).toBe('APPLIED');
        expect(await status()).toBe('ESTORNADA');
        expect(await raised()).toBe(antes - 20000);
      });
      it('pagamento vencido/cancelado → CANCELADA; evento de pagamento desconhecido é ignorado', async () => {
        const d3 = (await doar(4000).expect(201)).body.id;
        asaas.payments.get(await providerId(d3)).status = 'OVERDUE';
        await webhook(await providerId(d3), 'PAYMENT_OVERDUE').expect(200);
        expect((await db.getRepository(Donation).findOneByOrFail({ id: d3 })).status).toBe('CANCELADA');
        asaas.payments.set('pay_desconhecido', { id: 'pay_desconhecido', status: 'RECEIVED', value: 1, billingType: 'PIX' });
        expect((await webhook('pay_desconhecido').expect(200)).body.outcome).toBe('IGNORED_UNKNOWN_PAYMENT');
      });
      it('falha ao consultar o Asaas → 500 para o Asaas reenviar; reentrega processa', async () => {
        const d4 = (await doar(2500).expect(201)).body.id;
        const p4 = await providerId(d4);
        asaas.payments.get(p4).status = 'RECEIVED';
        const saved = asaas.payments.get(p4);
        asaas.payments.delete(p4);
        await webhook(p4, 'PAYMENT_RECEIVED', 'evt_retry').expect(500);
        asaas.payments.set(p4, saved);
        expect((await webhook(p4, 'PAYMENT_RECEIVED', 'evt_retry').expect(200)).body.outcome).toBe('APPLIED');
      });
      it('eventos ficam registrados na íntegra', async () => {
        const ev = await db.getRepository(PaymentEvent).findOneByOrFail({ providerEventId: 'evt_fixo_1' });
        expect(ev).toMatchObject({ event: 'PAYMENT_RECEIVED', providerPaymentId: pid, outcome: 'APPLIED' });
        expect(ev.payload).toMatchObject({ id: 'evt_fixo_1' });
      });
    });

    it('doador B não vê nem sincroniza a doação do doador A', async () => {
      const id = (await db.getRepository(Donation).findOneByOrFail({ amountCents: 20000 })).id;
      await http().get(`/my/donations/${id}`).auth(tokDoador2, { type: 'bearer' }).expect(404);
      await http().post(`/my/donations/${id}/sync`).auth(tokDoador2, { type: 'bearer' }).expect(404);
    });
    it('painel do doador: lista com campanha/ONG, valores, estados e resumo', async () => {
      const list = (await http().get('/my/donations').auth(tokDoador, { type: 'bearer' })).body;
      expect(list[0]).toMatchObject({ campaignTitle: expect.any(String), organizationName: expect.any(String) });
      const s = (await http().get('/my/donations/summary').auth(tokDoador, { type: 'bearer' })).body;
      expect(s).toMatchObject({ confirmed: 2, refunded: 1, cancelled: expect.any(Number), pending: expect.any(Number) });
      expect(s.totalConfirmedCents).toBe(3000 + 2500);
    });
    it('painel da ONG: totais, contagens, campanhas ativas e histórico financeiro', async () => {
      const d = (await http().get('/my/organization/dashboard').auth(tokOngP, { type: 'bearer' }).expect(200)).body;
      expect(d).toMatchObject({ totalRaisedCents: 5500, donationsConfirmed: 2, donationsRefunded: 1, activeCampaigns: 1 });
      expect(d.donationsPending).toBeGreaterThanOrEqual(1);
      expect(d.campaigns[0]).toMatchObject({ raisedCents: 5500 });
      const h = (await http().get('/my/organization/financial-history').auth(tokOngP, { type: 'bearer' })).body;
      expect(h.filter((x: any) => x.type === 'ESTORNO')).toHaveLength(1);
      expect(h.reduce((a: number, x: any) => a + x.amountCents, 0)).toBe(5500);
      await http().get('/my/organization/dashboard').auth(tokDoador, { type: 'bearer' }).expect(403);
    });
    it('campanha encerrada ou fora da janela de datas não recebe doação', async () => {
      await db.getRepository(Campaign).update(campP, { endsAt: new Date(Date.now() - 1000) });
      await doar(5000).expect(404);
      await db.getRepository(Campaign).update(campP, { endsAt: new Date(Date.now() + 86400_000) });
    });
    it('imagem da campanha: só JPG/PNG reais, só a dona', async () => {
      const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);
      await http().post(`/my/campaigns/${campP}/image`).auth(tokOngP, { type: 'bearer' }).attach('file', Buffer.from('<script>'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
      await http().post(`/my/campaigns/${campP}/image`).auth(tokB, { type: 'bearer' }).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(404);
      const r = await http().post(`/my/campaigns/${campP}/image`).auth(tokOngP, { type: 'bearer' }).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
      expect(r.body.imageUrl).toMatch(/^\/uploads\/campaigns\/[\w-]+\.png$/);
      await unlink(`${process.cwd()}${r.body.imageUrl}`);
    });

    describe('prestação de contas e transparência', () => {
      const ong = (m: 'get' | 'post' | 'patch', url: string, tok = tokOngP) => (http() as any)[m](url).auth(tok, { type: 'bearer' });
      const adm = (m: 'get' | 'post', url: string) => (http() as any)[m](url).auth(tokAdmin, { type: 'bearer' });
      const review = (path: string, body: object) => adm('post', path).send(body);
      const nf = (id: string, tok = tokOngP, kind = 'NOTA_FISCAL') => http().post(`/my/expenses/${id}/documents`).auth(tok, { type: 'bearer' }).field('kind', kind).attach('file', pdf, { filename: 'nf-com-cpf-52998224725.pdf', contentType: 'application/pdf' });
      const jpegExif = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe0, 0, 6, 74, 70, 73, 70]), Buffer.concat([Buffer.from([0xff, 0xe1, 0, 30]), Buffer.from('Exif GPS -23.55,-46.63 (xx)')]), Buffer.from([0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9])]);
      const foto = (fields: Record<string, string>, tok = tokOngP, buf = jpegExif) => {
        let r = http().post('/my/evidences').auth(tok, { type: 'bearer' });
        for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
        return r.attach('file', buf, { filename: 'foto.jpg', contentType: 'image/jpeg' });
      };
      const hoje = new Date().toISOString().slice(0, 10);
      let exp1: string, exp2: string, doc1: string, delivery: string, ev1: string, ev2: string;

      it('despesa: valida dados, ignora campos de controle e nasce ENVIADA', async () => {
        const base = { campaignId: campP, description: 'Compra de alimentos', category: 'Alimentos', amountCents: 4000, spentAt: hoje, supplier: 'João da Silva', supplierDocument: '529.982.247-25' };
        await ong('post', '/my/expenses').send({ ...base, spentAt: '2999-01-01' }).expect(400);
        await ong('post', '/my/expenses').send({ ...base, supplierDocument: '111.111.111-11' }).expect(400);
        const r = (await ong('post', '/my/expenses').send({ ...base, status: 'APROVADA', reviewedBy: 1 }).expect(201)).body;
        expect(r.status).toBe('ENVIADA');
        expect(r.reviewedBy).toBeNull();
        exp1 = r.id;
        exp2 = (await ong('post', '/my/expenses').send({ ...base, description: 'Material escolar', amountCents: 5000, supplier: 'Papelaria Central Ltda', supplierDocument: '11.222.333/0001-81' }).expect(201)).body.id;
      });
      it('comprovante: tipo obrigatório, conteúdo validado e nunca nasce aprovado', async () => {
        await nf(exp1, tokOngP, 'QUALQUER').expect(400);
        await ong('post', `/my/expenses/${exp1}/documents`).field('kind', 'RECIBO').attach('file', Buffer.from('MZ-exe'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400);
        const d = (await nf(exp1).expect(201)).body;
        expect(d).toMatchObject({ kind: 'NOTA_FISCAL', status: 'ENVIADA' });
        expect(d).not.toHaveProperty('content');
        doc1 = d.id;
        await nf(exp2).expect(201);
      });
      it('só administrador analisa; ONG não aprova a própria despesa', async () => {
        await ong('post', `/admin/expenses/${exp1}/review`).send({ action: 'APROVAR' }).expect(403);
        const q = (await adm('get', '/admin/accountability/queue').expect(200)).body;
        expect(q.expenses.map((e: any) => e.id)).toEqual(expect.arrayContaining([exp1, exp2]));
        expect(q.expenses[0]).toHaveProperty('organizationName');
      });
      it('não aprova despesa sem comprovante aprovado', async () => {
        const r = await review(`/admin/expenses/${exp1}/review`, { action: 'APROVAR' });
        expect(r.status).toBe(400);
        expect(r.body.message).toMatch(/comprovante/i);
      });
      it('em análise: ONG não altera nem anexa; pedido de complementação exige motivo e reabre a edição', async () => {
        await review(`/admin/expenses/${exp1}/review`, { action: 'INICIAR' }).expect(201);
        expect((await adm('get', `/admin/expenses/${exp1}`)).body.status).toBe('EM_ANALISE');
        await ong('patch', `/my/expenses/${exp1}`).send({ amountCents: 1 }).expect(400);
        await nf(exp1).expect(400);
        await review(`/admin/expenses/${exp1}/review`, { action: 'COMPLEMENTAR' }).expect(400);
        await review(`/admin/expenses/${exp1}/review`, { action: 'COMPLEMENTAR', reason: 'Envie também o comprovante de pagamento.' }).expect(201);
        const mine = (await ong('get', '/my/expenses')).body.find((e: any) => e.id === exp1);
        expect(mine).toMatchObject({ status: 'NECESSITA_COMPLEMENTACAO', reviewReason: 'Envie também o comprovante de pagamento.' });
        await nf(exp1, tokOngP, 'COMPROVANTE_PAGAMENTO').expect(201);
        await ong('post', `/my/expenses/${exp1}/resubmit`).expect(201);
        expect((await adm('get', `/admin/expenses/${exp1}`)).body.status).toBe('ENVIADA');
      });
      it('aprova comprovante (publicável) e despesa; depois ela fica imutável', async () => {
        const docs = (await adm('get', `/admin/expenses/${exp1}`)).body.documents;
        for (const d of docs) await review(`/admin/expense-documents/${d.id}/review`, { action: 'APROVAR', publishable: d.id === doc1 }).expect(201);
        await review(`/admin/expenses/${exp1}/review`, { action: 'APROVAR' }).expect(201);
        await review(`/admin/expenses/${exp1}/review`, { action: 'REPROVAR', reason: 'tentando reabrir' }).expect(400);
        await ong('patch', `/my/expenses/${exp1}`).send({ amountCents: 1 }).expect(400);
        await nf(exp1).expect(400);
      });
      it('despesa acima do saldo arrecadado não é aprovada', async () => {
        const d = (await adm('get', `/admin/expenses/${exp2}`)).body.documents[0];
        await review(`/admin/expense-documents/${d.id}/review`, { action: 'APROVAR' }).expect(201);
        const r = await review(`/admin/expenses/${exp2}/review`, { action: 'APROVAR' });
        expect(r.status).toBe(400);
        expect(r.body.message).toMatch(/saldo/);
      });
      it('entrega: quantidade distribuída ≤ comprada; campanha de outra ONG → 404; responsável preenchido', async () => {
        const base = { campaignId: campP, expenseId: exp1, itemDescription: 'Cestas básicas', quantityPurchased: 100, quantityDistributed: 90, unit: 'cestas', description: 'Distribuição para 90 famílias, contato maria@ong.org e CPF 529.982.247-25.', deliveredAt: hoje, region: 'Zona Leste - São Paulo/SP', locationDetail: 'Rua Privada 123 (interno)' };
        await ong('post', '/my/deliveries').send({ ...base, quantityDistributed: 101 }).expect(400);
        await ong('post', '/my/deliveries', tokB).send(base).expect(404);
        const d = (await ong('post', '/my/deliveries').send(base).expect(201)).body;
        expect(d.responsibleName).toBe('ongP');
        delivery = d.id;
      });
      it('evidências: vínculo obrigatório, tipo real validado, EXIF/GPS removido, nascem ENVIADAS', async () => {
        const f = { kind: 'FOTO_ENTREGA', description: 'Entrega das cestas à comunidade', takenAt: hoje };
        await foto(f).expect(400); // sem vínculo
        await foto({ ...f, deliveryRecordId: delivery }, tokB).expect(404); // entrega de outra ONG
        await foto({ ...f, deliveryRecordId: delivery }, tokOngP, Buffer.from('<svg onload=alert(1)>')).expect(400);
        const r = (await foto({ ...f, deliveryRecordId: delivery }).expect(201)).body;
        expect(r).toMatchObject({ status: 'ENVIADA', kind: 'FOTO_ENTREGA' });
        expect(r).not.toHaveProperty('content');
        ev1 = r.id;
        ev2 = (await foto({ ...f, kind: 'FOTO_ACAO', description: 'Foto da ação, não publicável', campaignId: campP }).expect(201)).body.id;
        const stored = await db.getRepository(Ev).findOne({ where: { id: ev1 }, select: { id: true, content: true } });
        expect(stored!.content.includes(Buffer.from('Exif'))).toBe(false);
        expect(stored!.content.includes(Buffer.from('GPS'))).toBe(false);
      });
      it('perfil público antes da análise: só a despesa aprovada; nada de entrega/evidência; sem dados sensíveis', async () => {
        const p = (await http().get(`/transparency/organizations/${orgP}`).expect(200)).body;
        expect(p.expenses.map((e: any) => e.id)).toEqual([exp1]);
        expect(p.expenses[0].supplier).toBe('Pessoa física (identidade protegida)');
        expect(p.deliveries).toEqual([]);
        expect(p.campaignEvidences).toEqual([]);
        const raw = JSON.stringify(p);
        expect(raw).not.toMatch(/52998224725|11222333000181|supplierDocument|locationDetail|responsibleName|Rua Privada|nf-com-cpf|content|sha256/);
        await http().get(`/transparency/evidences/${ev1}/file`).expect(404); // enviada ≠ aprovada
        await http().get(`/transparency/expense-documents/${doc1}/file`).expect(200);
      });
      it('totais são calculados dos registros e batem com o painel da ONG', async () => {
        const s = (await ong('get', '/my/accountability/summary').expect(200)).body;
        expect(s).toMatchObject({ totalRaisedCents: 5500, approvedExpensesCents: 4000, balanceCents: 1500, pendingExpensesCents: 5000, pendingExpensesCount: 1, deliveriesRegistered: 1, deliveriesVerified: 0 });
        const p = (await http().get(`/transparency/organizations/${orgP}`)).body;
        expect(p.totals).toEqual(expect.objectContaining({ totalRaisedCents: 5500, approvedExpensesCents: 4000, balanceCents: 1500, pendingExpensesCount: 1 }));
        expect(p.campaigns[0]).toMatchObject({ totalRaisedCents: 5500, approvedExpensesCents: 4000 });
        // não há como a ONG informar totais: campos extras são descartados
        await ong('patch', `/my/expenses/${exp2}`).send({ totalRaisedCents: 999999, balanceCents: 999999, amountCents: 4500 }).expect(200);
        expect((await ong('get', '/my/accountability/summary')).body.totalRaisedCents).toBe(5500);
      });
      it('aprovação de evidência: publicável aparece (redigida); não publicável fica oculta; arquivo público sem metadados', async () => {
        await review(`/admin/evidences/${ev1}/review`, { action: 'APROVAR', publishable: true }).expect(201);
        await review(`/admin/evidences/${ev2}/review`, { action: 'APROVAR', publishable: false }).expect(201);
        const p = (await http().get(`/transparency/organizations/${orgP}`)).body;
        expect(p.deliveries).toHaveLength(1);
        expect(p.deliveries[0]).toMatchObject({ region: 'Zona Leste - São Paulo/SP', quantityDistributed: 90 });
        expect(p.deliveries[0].description).toContain('[CPF removido]');
        expect(p.deliveries[0].description).toContain('[e-mail removido]');
        expect(p.deliveries[0].description).not.toMatch(/529\.982|maria@/);
        expect(p.deliveries[0].evidences.map((e: any) => e.id)).toEqual([ev1]);
        expect(p.campaignEvidences).toEqual([]); // ev2 aprovada, mas não publicável
        await http().get(`/transparency/evidences/${ev2}/file`).expect(404);
        const img = await http().get(`/transparency/evidences/${ev1}/file`).expect(200).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        expect(Buffer.from(img.body).includes(Buffer.from('Exif'))).toBe(false);
        expect((await ong('get', '/my/accountability/summary')).body.deliveriesVerified).toBe(1);
      });
      it('evidência com pedido de complementação volta à fila quando a ONG corrige', async () => {
        const ev3 = (await foto({ kind: 'FOTO_COMPRA', description: 'Foto da compra', takenAt: hoje, campaignId: campP }).expect(201)).body.id;
        await review(`/admin/evidences/${ev3}/review`, { action: 'COMPLEMENTAR', reason: 'Foto ilegível, envie outra descrição.' }).expect(201);
        await ong('patch', `/my/evidences/${ev3}`).send({ description: 'Foto da compra de alimentos no atacado' }).expect(200);
        expect((await adm('get', `/admin/evidences/${ev3}`)).body.status).toBe('ENVIADA');
        await review(`/admin/evidences/${ev3}/review`, { action: 'REPROVAR' }).expect(400); // motivo obrigatório
      });
      it('isolamento: outra ONG não vê despesas/evidências; ONG suspensa some do perfil público', async () => {
        expect((await ong('get', '/my/expenses', tokB)).body).toEqual([]);
        expect((await ong('get', '/my/evidences', tokB)).body).toEqual([]);
        await ong('get', `/evidences/${ev1}/file`, tokB).expect(404);
        expect((await ong('get', '/my/accountability/summary', tokB)).body).toMatchObject({ totalRaisedCents: 0, approvedExpensesCents: 0 });
        await http().get(`/transparency/organizations/${orgA}`).expect(404); // ONG A foi suspensa antes
        await ong('get', '/admin/accountability/queue').expect(403);
      });
    });
  });

  describe('sessões e proteção de login', () => {
    it('logout revoga o token; logout-all revoga todas as sessões', async () => {
      const t = (await login('doador@example.invalid')).body.access_token;
      await http().get('/my/donations').auth(t, { type: 'bearer' }).expect(200);
      await http().post('/auth/logout').auth(t, { type: 'bearer' }).expect(204);
      await http().get('/my/donations').auth(t, { type: 'bearer' }).expect(401);
      await http().post('/auth/logout-all').auth(tokDoador, { type: 'bearer' }).expect(201);
      await http().get('/my/donations').auth(tokDoador, { type: 'bearer' }).expect(401);
    });
    it('token sem sessão (forjado com o segredo, sem sid) é recusado', async () => {
      const jwt = app.get(JwtService);
      await http().get('/my/campaigns').auth(jwt.sign({ sub: 1, type: 'ONG' }), { type: 'bearer' }).expect(401);
    });
    it('bloqueia a conta após 5 senhas erradas, mesmo com a senha certa depois', async () => {
      for (let i = 0; i < 5; i++) await http().post('/users/login').send({ email: 'ongB@example.invalid', password: 'errada' }).expect(401);
      await login('ongB@example.invalid').expect(403);
    });
  });

  describe('auditoria', () => {
    it('registra as ações relevantes com responsável, entidade e organização', async () => {
      const logs = (await http().get('/admin/audit-logs?limit=500').auth(tokAdmin, { type: 'bearer' }).expect(200)).body;
      const actions = logs.map((l: any) => l.action);
      for (const a of ['LOGIN', 'LOGIN_LOCKED', 'MFA_ENABLED', 'ORG_CREATED', 'ORG_DOCUMENT_UPLOADED', 'ORG_SUBMITTED', 'ORG_APPROVED', 'ORG_DOCUMENTS_REQUESTED', 'ORG_CHECKS_RERUN', 'ORG_SUSPENDED', 'CAMPAIGN_CREATED', 'CAMPAIGN_PUBLISHED', 'EXPENSE_CREATED', 'EXPENSE_DOCUMENT_UPLOADED', 'EXPENSE_APPROVED', 'EXPENSE_COMPLEMENT_REQUESTED', 'DELIVERY_RECORDED', 'EVIDENCE_UPLOADED', 'EVIDENCE_REVIEWED', 'DONATION_CREATED', 'DONATION_CONFIRMED']) {
        expect(actions).toContain(a);
      }
      const aprov = logs.find((l: any) => l.action === 'ORG_APPROVED');
      expect(aprov).toMatchObject({ actorType: 'ADMIN', entityType: 'organization', organizationId: expect.any(String) });
      expect(aprov.createdAt).toBeDefined();
    });
    it('não expõe segredos nos logs', async () => {
      const raw = JSON.stringify(await db.getRepository(AuditLog).find());
      expect(raw).not.toMatch(/password|mfaSecret|Senha@12345/);
    });
    it('é imutável: UPDATE, DELETE e TRUNCATE são rejeitados pelo banco', async () => {
      const repo = db.getRepository(AuditLog);
      const t = `"${schema}"."audit_logs"`;
      await expect(db.query(`UPDATE ${t} SET action = 'ADULTERADO'`)).rejects.toThrow(/imutável/);
      await expect(db.query(`DELETE FROM ${t}`)).rejects.toThrow(/imutável/);
      await expect(repo.clear()).rejects.toThrow(/imutável/);
    });
    it('não há rota HTTP de escrita sobre logs', async () => {
      await http().delete('/admin/audit-logs').auth(tokAdmin, { type: 'bearer' }).expect(404);
      await http().patch('/admin/audit-logs').auth(tokAdmin, { type: 'bearer' }).send({}).expect(404);
    });
  });
});
