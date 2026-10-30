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
import axios from 'axios';
import { AccountabilityModule } from '../src/accountability/accountability.module';
import { DeliveryEvidence, DeliveryRecord } from '../src/accountability/entities/delivery.entity';
import { Expense, ExpenseDocument } from '../src/accountability/entities/expense.entity';
import { AuditLog } from '../src/audit/audit-log.entity';
import { AuditModule } from '../src/audit/audit.module';
import { Session } from '../src/auth/entities/session.entity';
import { totpAt } from '../src/auth/totp';
import { CampaignsModule } from '../src/campaigns/campaigns.module';
import { Campaign } from '../src/campaigns/entities/campaign.entity';
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
          entities: [User, Session, AuditLog, Organization, OrganizationDocument, OrganizationValidation, OrganizationExternalCheck, Campaign, Donation, Expense, ExpenseDocument, DeliveryRecord, DeliveryEvidence, Medalha, PedidoMedalhaBranca, DocumentoMedalhaBranca],
        }),
        AuditModule, UsersModule, OrganizationsModule, CampaignsModule, DonationsModule, AccountabilityModule, MedalhasModule,
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
    await criar('doador@example.invalid', UserType.DOADOR);
    await criar('admin@example.invalid', UserType.ADMIN);
    tokA = (await login('ongA@example.invalid')).body.access_token;
    tokB = (await login('ongB@example.invalid')).body.access_token;
    tokDoador = (await login('doador@example.invalid')).body.access_token;
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
      await http().post('/my/campaigns').auth(tokA, { type: 'bearer' }).send({ title: 'Campanha X', description: 'Descrição longa o bastante.', goalCents: 100000 }).expect(403);
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
      await http().post('/my/campaigns').auth(tokD, { type: 'bearer' }).send({ title: 'Campanha D', description: 'Descrição longa o bastante.', goalCents: 100000 }).expect(403);
    });
  });

  describe('isolamento entre ONGs', () => {
    it('ONG A cria campanha, despesa e comprovante; ONG B não os vê nem os manipula', async () => {
      campA = (await http().post('/my/campaigns').auth(tokA, { type: 'bearer' }).send({ title: 'Campanha A', description: 'Descrição longa o bastante.', goalCents: 500000 }).expect(201)).body.id;
      await http().post(`/my/campaigns/${campA}/status`).auth(tokA, { type: 'bearer' }).send({ status: 'ATIVA' }).expect(201);
      expA = (await http().post('/my/expenses').auth(tokA, { type: 'bearer' }).send({ campaignId: campA, description: 'Compra de cestas básicas', category: 'Alimentos', amountCents: 20000, spentAt: '2026-01-10' }).expect(201)).body.id;
      const doc = (await http().post(`/my/expenses/${expA}/documents`).auth(tokA, { type: 'bearer' }).attach('file', pdf, { filename: 'nf.pdf', contentType: 'application/pdf' }).expect(201)).body;
      expect(doc).not.toHaveProperty('content');

      expect((await http().get('/my/campaigns').auth(tokB, { type: 'bearer' })).body).toEqual([]);
      expect((await http().get('/my/expenses').auth(tokB, { type: 'bearer' })).body).toEqual([]);
      await http().get(`/my/campaigns/${campA}`).auth(tokB, { type: 'bearer' }).expect(404);
      await http().patch(`/my/campaigns/${campA}`).auth(tokB, { type: 'bearer' }).send({ title: 'Invadida' }).expect(404);
      await http().post(`/my/campaigns/${campA}/status`).auth(tokB, { type: 'bearer' }).send({ status: 'ENCERRADA' }).expect(404);
      await http().post('/my/expenses').auth(tokB, { type: 'bearer' }).send({ campaignId: campA, description: 'Despesa forjada', category: 'Outros', amountCents: 100, spentAt: '2026-01-10' }).expect(404);
      await http().post(`/my/expenses/${expA}/documents`).auth(tokB, { type: 'bearer' }).attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }).expect(404);
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
    it('doação só entra em campanha ativa; ONG vê apenas as suas e sem dados do doador', async () => {
      const d = (await http().post(`/campaigns/${campA}/donations`).auth(tokDoador, { type: 'bearer' }).send({ amountCents: 5000 }).expect(201)).body;
      await http().post(`/admin/donations/${d.id}/confirm`).auth(tokDoador, { type: 'bearer' }).expect(403);
      await http().post(`/admin/donations/${d.id}/confirm`).auth(tokAdmin, { type: 'bearer' }).expect(201);
      const a = (await http().get('/my/organization/donations').auth(tokA, { type: 'bearer' })).body;
      expect(a).toHaveLength(1);
      expect(a[0]).not.toHaveProperty('donorId');
      expect((await http().get('/my/organization/donations').auth(tokB, { type: 'bearer' })).body).toEqual([]);
      expect((await http().get('/campaigns')).body[0]).toMatchObject({ raisedCents: 5000 });
    });
    it('suspender a ONG derruba suas campanhas da vitrine', async () => {
      await http().post(`/admin/organizations/${orgA}/suspend`).auth(tokAdmin, { type: 'bearer' }).send({ reason: 'Denúncia procedente' }).expect(201);
      expect((await http().get('/campaigns')).body).toHaveLength(0);
      await http().post(`/campaigns/${campA}/donations`).auth(tokDoador, { type: 'bearer' }).send({ amountCents: 5000 }).expect(404);
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
      for (const a of ['LOGIN', 'LOGIN_LOCKED', 'MFA_ENABLED', 'ORG_CREATED', 'ORG_DOCUMENT_UPLOADED', 'ORG_SUBMITTED', 'ORG_APPROVED', 'ORG_DOCUMENTS_REQUESTED', 'ORG_CHECKS_RERUN', 'ORG_SUSPENDED', 'CAMPAIGN_CREATED', 'CAMPAIGN_PUBLISHED', 'EXPENSE_CREATED', 'EXPENSE_DOCUMENT_UPLOADED', 'DONATION_CREATED', 'DONATION_CONFIRMED']) {
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
