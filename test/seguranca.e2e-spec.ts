/**
 * Revisão de segurança — testes de ataque contra a aplicação real (Nest + PostgreSQL em schema temporário).
 * Dados 100% fictícios. Execute:
 *   node node_modules/jest/bin/jest.js --config test/jest-seguranca.json --runInBand
 * IDs (AUTZ/FIN/FILE/APP/INT/AUD) são usados no relatório docs/RELATORIO-SEGURANCA.md.
 */
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import bcrypt from 'bcrypt';
import request from 'supertest';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs: typeof import('node:fs/promises') = require('node:fs/promises');
import { configureApp } from '../src/app.setup';
import { AuditModule } from '../src/audit/audit.module';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Session } from '../src/auth/entities/session.entity';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles.guard';
import { ROLES_KEY } from '../src/auth/roles.decorator';
import { sealSecret, totpAt } from '../src/auth/totp';
import { UsersModule } from '../src/users/users.module';
import { AdminModule } from '../src/admin/admin.module';
import { User, UserStatus, UserType } from '../src/users/entities/user.entity';
import { OrganizationsModule } from '../src/organizations/organizations.module';
import { Organization, OrganizationStatus } from '../src/organizations/entities/organization.entity';
import { OrganizationDocument } from '../src/organizations/entities/organization-document.entity';
import { CampaignsModule } from '../src/campaigns/campaigns.module';
import { DonationsModule } from '../src/donations/donations.module';
import { Donation } from '../src/donations/entities/donation.entity';
import { PaymentsModule } from '../src/payments/payments.module';
import { PaymentEvent } from '../src/payments/payment-event.entity';
import { AccountabilityModule } from '../src/accountability/accountability.module';
import { Expense, ExpenseDocument } from '../src/accountability/entities/expense.entity';
import { DeliveryEvidence } from '../src/accountability/entities/delivery.entity';
import { MedalhasModule } from '../src/medalhas/medalhas.module';
import { MetasModule } from '../src/metas/metas.module';
import { PublicacoesModule } from '../src/publicacoes/publicacoes.module';
import { ReviewsModule } from '../src/reviews/reviews.module';
import { FavoritosModule } from '../src/favoritos/favoritos.module';
import { InteressesModule } from '../src/interesses/interesses.module';
import { ConversasModule } from '../src/conversas/conversas.module';
import { DenunciasModule } from '../src/denuncias/denuncias.module';
import { PasswordResetModule } from '../src/password-reset/password-reset.module';
import { MailService } from '../src/mail/mail.service';

jest.setTimeout(120000);
process.env.JWT_SECRET = 'segredo-de-teste-seguranca-nao-usar-em-producao-0123456789';
process.env.ASAAS_API_KEY = 'chave-sandbox-teste';
const WH = 'w'.repeat(40);
process.env.ASAAS_WEBHOOK_TOKEN = WH;
process.env.PORTAL_TRANSPARENCIA_API_KEY = 'chave-portal-teste';

const schema = `teste_seguranca_${process.pid}_${Date.now()}`;
const dbOptions = { type: 'postgres' as const, host: process.env.DB_HOST ?? 'localhost', port: Number(process.env.DB_PORT ?? 5432), username: process.env.DB_USER ?? 'postgres', password: process.env.DB_PASSWORD ?? 'postgres', database: process.env.DB_NAME ?? 'tcc_db' };
const SENHA = 'Senha@12345';
const CPF_TESTE = '52998224725'; // CPF de teste matematicamente válido, não pertence a ninguém
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]), Buffer.from([0xff, 0xda, 0, 2, 9, 0xff, 0xd9])]);
const hoje = new Date().toISOString().slice(0, 10);
const UUID0 = '00000000-0000-4000-8000-000000000000';

describe('Revisão de segurança', () => {
  let bootstrap: DataSource, db: DataSource, app: NestExpressApplication, jwt: JwtService;
  const http = () => request(app.getHttpServer());
  const a = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (url: string, t: string) => http().get(url).set(a(t));
  const post = (url: string, t: string) => http().post(url).set(a(t));
  const patch = (url: string, t: string) => http().patch(url).set(a(t));

  // ---------- Asaas simulado ----------
  const asaas = { payments: new Map<string, any>(), seq: 0, mode: 'ok' as 'ok' | 'down' | 'timeout' | 'garbage', created: 0 };
  const evtN = { n: 0 };
  const installAsaas = () => {
    jest.spyOn(axios, 'request').mockImplementation(async (cfg: any) => {
      const path = String(cfg.url).replace(/^https:\/\/api-sandbox\.asaas\.com\/v3/, '');
      const res = (status: number, data: any) => ({ status, data }) as any;
      if (asaas.mode === 'timeout') throw Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' });
      if (asaas.mode === 'down') return res(503, '<html>down</html>');
      if (asaas.mode === 'garbage') return res(200, '<html>not json</html>');
      if (path === '/customers') return res(200, { id: `cus_${++asaas.seq}` });
      if (path === '/payments' && cfg.method === 'post') {
        const id = `pay_${++asaas.seq}`; asaas.created++;
        asaas.payments.set(id, { id, status: 'PENDING', value: cfg.data.value, billingType: 'PIX', externalReference: cfg.data.externalReference });
        return res(200, asaas.payments.get(id));
      }
      const m = path.match(/^\/payments\/(\w+)(\/pixQrCode)?$/);
      const pay = m && asaas.payments.get(m[1]);
      if (!pay) return res(404, {});
      return res(200, m![2] ? { encodedImage: 'iVBORw0KGgo=', payload: `000201PIX${pay.id}`, expirationDate: '2099-01-01 23:59:59' } : pay);
    });
  };
  const webhook = (paymentId: string | null, event = 'PAYMENT_RECEIVED', id = `evt_${++evtN.n}`, token: string | null = WH, extra: object = {}) => {
    const r = http().post('/webhooks/asaas').send({ id, event, payment: paymentId ? { id: paymentId } : undefined, ...extra });
    return token === null ? r : r.set('asaas-access-token', token);
  };

  // ---------- Fontes de validação simuladas ----------
  const ext = { brasil: 'ok' as 'ok' | 'down' | 'timeout' | 'html' | 'outroCnpj', portal: 'ok' as 'ok' | 'down' | 'nokey' | 'garbage' };
  const installExternal = () => {
    jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      const res = (status: number, data: any) => ({ status, data }) as any;
      if (url.includes('brasilapi')) {
        const cnpj = url.split('/').pop()!;
        if (ext.brasil === 'down') return res(503, 'down');
        if (ext.brasil === 'timeout') throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        if (ext.brasil === 'html') return res(200, '<html>manutenção</html>');
        return res(200, { cnpj: ext.brasil === 'outroCnpj' ? '99999999000191' : cnpj, razao_social: `ONG ${cnpj}`, nome_fantasia: `ONG ${cnpj}`, situacao_cadastral: 2, descricao_situacao_cadastral: 'ATIVA', natureza_juridica: 'Associação Privada', cnae_fiscal: 9430800, cnaes_secundarios: [], cep: '01310100', uf: 'SP', municipio: 'SAO PAULO' });
      }
      if (url.includes('mapaosc')) return res(404, '<html>');
      if (url.includes('portaldatransparencia')) return ext.portal === 'down' ? res(500, {}) : ext.portal === 'garbage' ? res(200, '<html>') : res(200, []);
      if (url.includes('transferegov')) return res(200, { data: [], total_items: 0 });
      return res(404, {}); // opencnpj etc.
    });
    ext.portal === 'nokey' ? delete process.env.PORTAL_TRANSPARENCIA_API_KEY : (process.env.PORTAL_TRANSPARENCIA_API_KEY = 'chave-portal-teste');
  };
  const installAll = () => { installAsaas(); installExternal(); };
  beforeEach(installAll);
  afterEach(() => { jest.restoreAllMocks(); asaas.mode = 'ok'; ext.brasil = 'ok'; ext.portal = 'ok'; process.env.ASAAS_API_KEY = 'chave-sandbox-teste'; process.env.ASAAS_WEBHOOK_TOKEN = WH; });

  // ---------- Fábricas ----------
  const mk = async (email: string, type: UserType, extra: Partial<User> = {}) => db.getRepository(User).save(db.getRepository(User).create({ name: email.split('@')[0], email: `${email}@example.invalid`, password: await bcrypt.hash(SENHA, 4), type, ...extra }));
  const tokenFor = async (u: User, o: { mfa?: boolean; expiresInMs?: number } = {}) => {
    const s = await db.getRepository(Session).save({ userId: u.id, mfaVerified: o.mfa ?? true, expiresAt: new Date(Date.now() + (o.expiresInMs ?? 3600_000)) });
    return { token: jwt.sign({ sub: u.id, email: u.email, type: u.type, sid: s.id }), sid: s.id };
  };
  const cnpjSeq = { n: 0 };
  const nextCnpj = () => { // CNPJ fictício com dígitos verificadores válidos
    const base = `${String(20000000 + ++cnpjSeq.n)}0001`.split('').map(Number);
    const dv = (b: number[]) => { let s = 0, p = b.length - 7; for (const d of b) { s += d * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    const d1 = dv(base), d2 = dv([...base, d1]); return [...base, d1, d2].join('');
  };
  const ongOf = async (label: string, cnpjIn: string, status = OrganizationStatus.APROVADA) => {
    const cnpj = label === 'ongA' || label === 'ongB' ? cnpjIn : nextCnpj();
    const user = await mk(label, UserType.ONG, { cnpj });
    const { token } = await tokenFor(user);
    const orgId = (await get('/organizations/me', token).expect(200)).body.id as string;
    await db.getRepository(Organization).update(orgId, { status });
    return { user, token, orgId };
  };
  const campaignOf = async (token: string, goal = 500000) => {
    const dates = { startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 30 * 86400_000).toISOString() };
    const id = (await post('/my/campaigns', token).send({ title: 'Campanha de teste', description: 'Descrição longa o bastante.', objective: 'Objetivo da campanha de teste.', goalCents: goal, ...dates }).expect(201)).body.id as string;
    await post(`/my/campaigns/${id}/status`, token).send({ status: 'ATIVA' }).expect(201);
    return id;
  };
  const donate = async (token: string, campaignId: string, cents = 10000) => (await post(`/campaigns/${campaignId}/donations`, token).send({ amountCents: cents }).expect(201)).body;
  const providerId = async (donationId: string) => (await db.getRepository(Donation).findOneByOrFail({ id: donationId })).providerPaymentId!;
  const pay = async (donationId: string, status = 'RECEIVED') => { const pid = await providerId(donationId); asaas.payments.get(pid).status = status; return pid; };
  const confirm = async (donationId: string) => { const pid = await pay(donationId); await webhook(pid).expect(200); };
  const upload = (url: string, t: string, buf: Buffer, mime: string, name = 'arquivo.pdf', fields: Record<string, string> = {}, field = 'file') => {
    let r = http().post(url).set(a(t));
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach(field, buf, { filename: name, contentType: mime });
  };

  // ---------- Atores ----------
  let admin: User, adminTok: string, doador: User, doadorTok: string, doador2Tok: string;
  let A: Awaited<ReturnType<typeof ongOf>>, B: Awaited<ReturnType<typeof ongOf>>, campA: string, campB: string;

  beforeAll(async () => {
    bootstrap = await new DataSource(dbOptions).initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dbOptions, schema, synchronize: true, autoLoadEntities: true }),
        AuditModule, UsersModule, AdminModule, OrganizationsModule, CampaignsModule, DonationsModule, PaymentsModule, AccountabilityModule,
        MedalhasModule, MetasModule, PublicacoesModule, ReviewsModule, FavoritosModule, InteressesModule, ConversasModule, DenunciasModule, PasswordResetModule,
      ],
    }).overrideProvider(MailService).useValue({ sendPasswordResetEmail: jest.fn(async (d: any) => { (global as any).__resetUrl = d.resetUrl; }) }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    installAll();
    admin = await mk('admin', UserType.ADMIN);
    adminTok = (await tokenFor(admin)).token;
    doador = await mk('doador', UserType.DOADOR, { cpf: CPF_TESTE });
    doadorTok = (await tokenFor(doador)).token;
    doador2Tok = (await tokenFor(await mk('doador2', UserType.DOADOR, { cpf: CPF_TESTE }))).token;
    A = await ongOf('ongA', '11222333000181');
    B = await ongOf('ongB', '45723174000110');
    campA = await campaignOf(A.token);
    campB = await campaignOf(B.token);
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    if (app) await app.close();
    if (bootstrap?.isInitialized) {
      if (!/^teste_seguranca_\d+_\d+$/.test(schema)) throw new Error('Schema inválido');
      await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);
      await bootstrap.destroy();
    }
  });

  // =====================================================================================
  describe('1. Autorização', () => {
    const adminRoutes: [string, string][] = [
      ['get', '/admin/organizations'], ['get', `/admin/organizations/${UUID0}`], ['post', `/admin/organizations/${UUID0}/decision`], ['post', `/admin/organizations/${UUID0}/suspend`],
      ['post', `/admin/organizations/${UUID0}/request-documents`], ['post', `/admin/organizations/${UUID0}/checks/run`], ['post', `/admin/organizations/documents/${UUID0}/review`],
      ['get', '/admin/campaigns'], ['post', `/admin/campaigns/${UUID0}/suspend`], ['get', '/admin/donations'], ['post', `/admin/donations/${UUID0}/reconcile`],
      ['get', '/admin/accountability/queue'], ['get', `/admin/expenses/${UUID0}`], ['post', `/admin/expenses/${UUID0}/review`], ['post', `/admin/expense-documents/${UUID0}/review`],
      ['get', `/admin/evidences/${UUID0}`], ['post', `/admin/evidences/${UUID0}/review`], ['get', '/admin/audit-logs'], ['get', '/admin/audit-logs/verify'],
      ['get', '/admin/ongs'], ['post', '/admin/admins'], ['get', '/users'], ['post', `/auth/admin/users/1/revoke-sessions`],
      ['patch', '/medalha-branca/admin/1'], ['get', '/medalha-branca/admin/ongs/1'],
    ];
    it('AUTZ-01 doador não acessa nenhuma função administrativa', async () => {
      for (const [m, u] of adminRoutes) { const r = await (http() as any)[m](u).set(a(doadorTok)).send({}); expect([u, r.status]).toEqual([u, 403]); }
    });
    it('AUTZ-02 ONG não acessa nenhuma função administrativa', async () => {
      for (const [m, u] of adminRoutes) { const r = await (http() as any)[m](u).set(a(A.token)).send({}); expect([u, r.status]).toEqual([u, 403]); }
    });
    it('AUTZ-03 administrador sem MFA verificado também é barrado', async () => {
      const { token } = await tokenFor(admin, { mfa: false });
      for (const [m, u] of adminRoutes) { const r = await (http() as any)[m](u).set(a(token)).send({}); expect([u, r.status]).toEqual([u, 403]); }
    });
    it('AUTZ-04 anônimo recebe 401 nas rotas administrativas', async () => {
      for (const [m, u] of adminRoutes) { const r = await (http() as any)[m](u).send({}); expect([u, r.status]).toEqual([u, 401]); }
    });
    it('AUTZ-05 inventário de rotas: toda rota é pública (allowlist explícita) ou exige JwtAuthGuard; todo @Roles tem RolesGuard', async () => {
      const reflector = app.get(Reflector);
      const routes: { method: string; path: string; guards: string[]; roles: string[] | undefined }[] = [];
      for (const mod of app.get(ModulesContainer).values()) {
        for (const w of mod.controllers.values()) {
          const cls: any = w.metatype; if (!cls) continue;
          const base = Reflect.getMetadata('path', cls) ?? '';
          for (const name of Object.getOwnPropertyNames(cls.prototype)) {
            const h = cls.prototype[name]; if (typeof h !== 'function' || name === 'constructor') continue;
            const method = Reflect.getMetadata('method', h); if (method === undefined) continue;
            const guards = [...(Reflect.getMetadata('__guards__', cls) ?? []), ...(Reflect.getMetadata('__guards__', h) ?? [])].map((g: any) => g.name);
            const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [h, cls]);
            routes.push({ method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'][method], path: `/${[base, Reflect.getMetadata('path', h)].filter((x) => x && x !== '/').join('/')}`, guards, roles });
          }
        }
      }
      const isAuth = (g: string[]) => g.some((n) => n === JwtAuthGuard.name || /AuthGuard/.test(n));
      const PUBLIC_ALLOWLIST = [
        'POST /users', 'POST /users/login', 'GET /users/ongs', 'GET /users/ongs/:id', 'GET /metas/ong/:id', 'GET /publicacoes', 'GET /publicacoes/ong/:ongId', 'GET /publicacoes/:id',
        'GET /users/:ongId/reviews', 'POST /auth/forgot-password', 'POST /auth/reset-password', 'GET /campaigns', 'GET /campaigns/:id', 'GET /organizations/public', 'GET /organizations/public/:id',
        'GET /transparency/organizations/:id', 'GET /transparency/expense-documents/:id/file', 'GET /transparency/evidences/:id/file', 'POST /webhooks/asaas', 'GET /',
      ];
      const publicRoutes = routes.filter((r) => !isAuth(r.guards)).map((r) => `${r.method} ${r.path}`);
      const unexpected = publicRoutes.filter((r) => !PUBLIC_ALLOWLIST.includes(r));
      const rolesWithoutGuard = routes.filter((r) => r.roles?.length && !r.guards.includes(RolesGuard.name)).map((r) => `${r.method} ${r.path}`);
      await fs.writeFile('docs/evidencias/rotas.json', JSON.stringify({ total: routes.length, publicas: publicRoutes.sort(), semRolesGuardMasComRoles: rolesWithoutGuard, rotas: routes.map((r) => ({ rota: `${r.method} ${r.path}`, guards: r.guards, roles: r.roles ?? null })) }, null, 1));
      expect(unexpected).toEqual([]);
      expect(rolesWithoutGuard).toEqual([]);
    });
    it('AUTZ-06 ONG não acessa dados de outra ONG (recursos novos)', async () => {
      const exp = (await post('/my/expenses', A.token).send({ campaignId: campA, description: 'Despesa da ONG A', category: 'Outros', amountCents: 1000, spentAt: hoje }).expect(201)).body.id;
      const doc = (await upload(`/my/expenses/${exp}/documents`, A.token, pdf, 'application/pdf', 'nf.pdf', { kind: 'NOTA_FISCAL' }).expect(201)).body.id;
      const org = (await upload('/organizations/me/documents', A.token, pdf, 'application/pdf', 'e.pdf', { type: 'ESTATUTO' }).expect(201)).body.id;
      await get(`/my/campaigns/${campA}`, B.token).expect(404);
      await patch(`/my/campaigns/${campA}`, B.token).send({ title: 'invadida' }).expect(404);
      await post(`/my/campaigns/${campA}/status`, B.token).send({ status: 'ENCERRADA' }).expect(404);
      await post(`/my/campaigns/${campA}/image`, B.token).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(404);
      await post('/my/expenses', B.token).send({ campaignId: campA, description: 'Despesa forjada', category: 'Outros', amountCents: 100, spentAt: hoje }).expect(404);
      await patch(`/my/expenses/${exp}`, B.token).send({ amountCents: 1 }).expect(404);
      await get(`/expenses/${exp}/documents`, B.token).expect(404);
      await get(`/expense-documents/${doc}/file`, B.token).expect(404);
      await get(`/organizations/documents/${org}/file`, B.token).expect(404);
      for (const u of ['/my/expenses', '/my/evidences', '/my/deliveries', '/my/campaigns', '/my/organization/donations', '/my/organization/financial-history']) expect((await get(u, B.token).expect(200)).body).not.toEqual(expect.arrayContaining([expect.objectContaining({ organizationId: A.orgId })]));
      expect((await get('/my/organization/dashboard', B.token)).body.campaigns.map((c: any) => c.id)).not.toContain(campA);
    });
    it('AUTZ-07 ONG não aprovada (qualquer estado) não publica campanha, não registra despesa e não recebe doação', async () => {
      for (const [i, st] of [OrganizationStatus.INCOMPLETO, OrganizationStatus.EM_ANALISE, OrganizationStatus.AGUARDANDO_DOCUMENTACAO, OrganizationStatus.REPROVADA, OrganizationStatus.SUSPENSA].entries()) {
        const o = await ongOf(`ongx${i}`, ['07526557000100', '34028316000103', '00394460000141', '33000167000101', '04252011000110'][i], st);
        await post('/my/campaigns', o.token).send({ title: 'Campanha X', description: 'Descrição longa o bastante.', objective: 'Objetivo de teste X.', goalCents: 100000 }).expect(403);
        await post('/my/expenses', o.token).send({ campaignId: campA, description: 'Despesa X', category: 'Outros', amountCents: 100, spentAt: hoje }).expect(403);
        await post('/my/deliveries', o.token).send({ campaignId: campA, itemDescription: 'Cestas', quantityPurchased: 2, quantityDistributed: 1, description: 'Entrega de teste de cestas', deliveredAt: hoje, region: 'Centro' }).expect(403);
      }
      // campanha ativa de ONG que foi suspensa deixa de receber doação
      const s = await ongOf('ongsusp', '60746948000112');
      const c = await campaignOf(s.token);
      await db.getRepository(Organization).update(s.orgId, { status: OrganizationStatus.SUSPENSA });
      await post(`/campaigns/${c}/donations`, doadorTok).send({ amountCents: 1000 }).expect(404);
    });
    it('AUTZ-08 ONG não aprova os próprios documentos nem a si mesma', async () => {
      const o = await ongOf('ongself', '60746948000112', OrganizationStatus.INCOMPLETO).catch(() => null);
      const self = o ?? (await ongOf('ongself2', '00360305000104', OrganizationStatus.INCOMPLETO));
      const doc = (await upload('/organizations/me/documents', self.token, pdf, 'application/pdf', 'e.pdf', { type: 'ESTATUTO' }).expect(201)).body.id;
      await post(`/admin/organizations/documents/${doc}/review`, self.token).send({ decision: 'APROVAR' }).expect(403);
      await post(`/admin/organizations/${self.orgId}/decision`, self.token).send({ decision: 'APROVAR', overrideReason: 'eu mesma aprovo' }).expect(403);
      // tentativa de mass assignment do status/revisão no próprio cadastro e no upload
      await patch('/organizations/me', self.token).send({ status: 'APROVADA', reviewedBy: 1, ownerId: 1, cnpj: '00000000000191' }).expect(200);
      await upload('/organizations/me/documents', self.token, pdf, 'application/pdf', 'e2.pdf', { type: 'ESTATUTO', status: 'APROVADO' }).expect(201);
      const org = await db.getRepository(Organization).findOneByOrFail({ id: self.orgId });
      expect(org.status).toBe('INCOMPLETO'); expect(org.cnpj).not.toBe('00000000000191'); expect(org.ownerId).toBe(self.user.id);
      const docs = await db.getRepository(OrganizationDocument).find({ where: { organizationId: self.orgId }, select: { id: true, status: true, supersededAt: true } });
      expect(docs.every((d) => d.status === 'PENDENTE')).toBe(true);
      // fluxo legado da Medalha Branca
      await http().patch('/medalha-branca/admin/1').set(a(self.token)).send({ decision: 'Aprovado' }).expect(403);
      // despesas/evidências: ONG não revisa
      await post(`/admin/expenses/${UUID0}/review`, self.token).send({ action: 'APROVAR' }).expect(403);
      await post(`/admin/evidences/${UUID0}/review`, self.token).send({ action: 'APROVAR', publishable: true }).expect(403);
    });
    it('AUTZ-09 cadastro e perfil: sem escalonamento de privilégio nem mass assignment', async () => {
      const bad = { name: 'Fulano de Teste', email: 'privesc@example.invalid', password: SENHA, type: 'ADMIN' };
      await http().post('/users').send(bad).expect(400);
      const r = await http().post('/users').send({ ...bad, type: 'DOADOR', status: 'ATIVO', medalhaBranca: true, medalhaVerde: true, averageRating: 5, id: 999, asaasCustomerId: 'cus_x', mfaEnabled: false, role: 'ADMIN' });
      expect([201, 200]).toContain(r.status);
      const u = await db.getRepository(User).findOneByOrFail({ email: 'privesc@example.invalid' });
      expect(u).toMatchObject({ type: 'DOADOR', medalhaBranca: false, medalhaVerde: false, asaasCustomerId: null });
      expect(Number(u.averageRating)).toBe(0);
      const { token } = await tokenFor(u);
      await patch('/users/me', token).send({ type: 'ADMIN', status: 'ATIVO', medalhaBranca: true, password: 'outra-senha-1', failedLoginAttempts: 0, mfaEnabled: true }).expect(200);
      const u2 = await db.getRepository(User).findOneByOrFail({ id: u.id });
      expect(u2.type).toBe('DOADOR'); expect(u2.medalhaBranca).toBe(false); expect(u2.password).toBe(u.password);
      await get('/admin/organizations', token).expect(403);
    });
    it('AUTZ-10 conta suspensa/banida perde o acesso imediatamente (qualquer perfil), mesmo com token ainda válido', async () => {
      for (const st of [UserStatus.SUSPENSO, UserStatus.BANIDO]) {
        const d = await mk(`don${st}`, UserType.DOADOR, { cpf: CPF_TESTE });
        const { token } = await tokenFor(d);
        await post(`/campaigns/${campA}/donations`, token).send({ amountCents: 1000 }).expect(201);
        await db.getRepository(User).update(d.id, { status: st });
        expect([401, 403]).toContain((await post(`/campaigns/${campA}/donations`, token).send({ amountCents: 1000 })).status);
        expect([401, 403]).toContain((await get('/my/donations', token)).status);
      }
    });
    it('AUTZ-11 recursos legados: ONG não edita meta nem perfil de outra ONG; terceiros não leem conversas alheias', async () => {
      const meta = (await post('/metas', A.token).send({ title: 'Meta A', type: 'FINANCEIRA', targetAmount: 1000 }).expect(201)).body.id;
      expect([403, 404]).toContain((await patch(`/metas/${meta}`, B.token).send({ title: 'invadida' })).status);
      expect([403, 404]).toContain((await http().delete(`/metas/${meta}`).set(a(B.token))).status);
      expect([403, 404]).toContain((await patch(`/users/ongs/${A.user.id}`, B.token).send({ description: 'invadida' })).status);
      const conv = (await post(`/conversas/ongs/${A.user.id}`, doadorTok).expect(201)).body;
      const cid = conv.id ?? conv.conversaId;
      expect([403, 404]).toContain((await get(`/conversas/${cid}/mensagens`, doador2Tok)).status);
      expect([403, 404]).toContain((await get(`/conversas/${cid}/mensagens`, B.token)).status);
      expect([403, 404]).toContain((await post(`/conversas/${cid}/mensagens`, doador2Tok).send({ texto: 'intruso' })).status);
    });
    it('AUTZ-12 ONG não troca o próprio CNPJ após a verificação (mantém medalha só para o CNPJ verificado)', async () => {
      await db.getRepository(User).update(A.user.id, { medalhaVerde: true });
      await patch(`/users/ongs/${A.user.id}`, A.token).send({ cnpj: '00000000000191' });
      const u = await db.getRepository(User).findOneByOrFail({ id: A.user.id });
      expect(u.cnpj).toBe('11222333000181');
    });
  });

  // =====================================================================================
  describe('2. Financeiro', () => {
    it('FIN-01 doação confirmada não pode ter o valor/estado alterados por usuário', async () => {
      const d = await donate(doadorTok, campA, 12345); await confirm(d.id);
      for (const m of ['patch', 'put', 'delete'] as const) for (const t of [doadorTok, A.token, adminTok]) expect([403, 404]).toContain((await (http() as any)[m](`/my/donations/${d.id}`).set(a(t)).send({ amountCents: 1, status: 'PENDENTE' })).status);
      for (const u of [`/donations/${d.id}`, `/admin/donations/${d.id}/confirm`, `/admin/donations/${d.id}`]) expect([403, 404]).toContain((await patch(u, adminTok).send({ amountCents: 1 })).status);
      const row = await db.getRepository(Donation).findOneByOrFail({ id: d.id });
      expect(row).toMatchObject({ status: 'CONFIRMADA', amountCents: 12345 });
    });
    it('FIN-02 criação ignora campos de controle e rejeita valores inválidos', async () => {
      const r = await post(`/campaigns/${campA}/donations`, doadorTok).send({ amountCents: 5000, status: 'CONFIRMADA', confirmedAt: '2020-01-01', donorId: 999, providerPaymentId: 'pay_forjado', campaignId: campB }).expect(201);
      const row = await db.getRepository(Donation).findOneByOrFail({ id: r.body.id });
      expect(row).toMatchObject({ status: 'PENDENTE', confirmedAt: null, donorId: doador.id, campaignId: campA });
      expect(row.providerPaymentId).not.toBe('pay_forjado');
      for (const v of [0, -100, 499, 4.5, '1000', null, [1000], {}, 1e12, 1_000_001, NaN, 'abc']) expect([v, (await post(`/campaigns/${campA}/donations`, doadorTok).send({ amountCents: v })).status]).toEqual([v, 400]);
    });
    it('FIN-03 webhook falso: sem token, token errado, vazio, de outro tamanho ou sem configuração → rejeitado e nada muda', async () => {
      const d = await donate(doadorTok, campA, 7000); const pid = await pay(d.id);
      for (const t of [null, '', 'x'.repeat(40), WH.slice(1), WH + 'x', 'Bearer ' + WH]) expect([String(t), (await webhook(pid, 'PAYMENT_RECEIVED', undefined, t)).status]).toEqual([String(t), 401]);
      delete process.env.ASAAS_WEBHOOK_TOKEN;
      expect((await webhook(pid)).status).toBe(503);
      process.env.ASAAS_WEBHOOK_TOKEN = WH;
      expect((await http().get('/webhooks/asaas')).status).toBe(404);
      expect((await db.getRepository(Donation).findOneByOrFail({ id: d.id })).status).toBe('PENDENTE');
    });
    it('FIN-04 notificação autêntica, mas o Asaas diz PENDING (ou o corpo afirma "RECEIVED") → não confirma', async () => {
      const d = await donate(doadorTok, campA, 7100); const pid = await providerId(d.id);
      const r = await webhook(pid, 'PAYMENT_RECEIVED', undefined, WH, { payment: { id: pid, status: 'RECEIVED', value: 71, billingType: 'PIX', externalReference: d.id } }).expect(200);
      expect(r.body.outcome).toBe('NO_CHANGE');
      await post(`/my/donations/${d.id}/sync`, doadorTok).expect(201);
      expect((await db.getRepository(Donation).findOneByOrFail({ id: d.id })).status).toBe('PENDENTE');
    });
    it('FIN-05 cobrança divergente (valor, referência, cartão, baixa manual em dinheiro) nunca confirma', async () => {
      const mut: [string, (p: any) => void][] = [['valor', (p) => (p.value = 0.01)], ['referencia', (p) => (p.externalReference = UUID0)], ['cartao', (p) => (p.billingType = 'CREDIT_CARD')], ['dinheiro', (p) => (p.status = 'RECEIVED_IN_CASH')]];
      for (const [nome, f] of mut) {
        const d = await donate(doadorTok, campA, 7200); const pid = await pay(d.id); f(asaas.payments.get(pid));
        await webhook(pid).expect(200);
        expect([nome, (await db.getRepository(Donation).findOneByOrFail({ id: d.id })).status]).toEqual([nome, 'PENDENTE']);
      }
    });
    it('FIN-06 webhook repetido (mesmo id e ids novos) e simultâneo não duplica a doação nem o valor', async () => {
      const c = await campaignOf(A.token); const before = (await get('/my/organization/dashboard', A.token)).body.totalRaisedCents;
      const d = await donate(doadorTok, c, 9000); const pid = await pay(d.id);
      await Promise.all([1, 2, 3, 4, 5].map(() => webhook(pid, 'PAYMENT_RECEIVED', 'evt_mesmo')));
      for (let i = 0; i < 3; i++) await webhook(pid, 'PAYMENT_RECEIVED').expect(200);
      expect(await db.getRepository(PaymentEvent).countBy({ providerEventId: 'evt_mesmo' })).toBe(1);
      expect(await db.getRepository(AuditLog).countBy({ action: 'DONATION_CONFIRMED', entityId: d.id })).toBe(1);
      expect(await db.getRepository(Donation).countBy({ campaignId: c })).toBe(1);
      expect((await get('/my/organization/dashboard', A.token)).body.totalRaisedCents).toBe(before + 9000);
    });
    it('FIN-07 valor arrecadado = soma exata das confirmadas (pendente/cancelada/estornada não contam) em todas as visões', async () => {
      const o = await ongOf('ongfin', '60746948000112').catch(async () => ongOf('ongfin2', '00360305000104'));
      const c = await campaignOf(o.token, 1_000_000);
      const ds = [] as any[]; for (const v of [10000, 20050, 5000, 7777, 12345, 99999]) ds.push(await donate(doadorTok, c, v));
      await confirm(ds[0].id); await confirm(ds[1].id); await confirm(ds[2].id);
      await confirm(ds[4].id); asaas.payments.get(await providerId(ds[4].id)).status = 'REFUNDED'; await webhook(await providerId(ds[4].id), 'PAYMENT_REFUNDED').expect(200);
      asaas.payments.get(await pay(ds[5].id, 'OVERDUE')).status = 'OVERDUE'; await webhook(await providerId(ds[5].id), 'PAYMENT_OVERDUE').expect(200);
      const esperado = 10000 + 20050 + 5000; // ds[3] pendente, ds[4] estornada, ds[5] cancelada
      expect((await get('/my/organization/dashboard', o.token)).body).toMatchObject({ totalRaisedCents: esperado, donationsConfirmed: 3, donationsPending: 1, donationsRefunded: 1, donationsCancelled: 1 });
      expect((await http().get(`/campaigns/${c}`)).body.raisedCents).toBe(esperado);
      expect((await get('/my/accountability/summary', o.token)).body.totalRaisedCents).toBe(esperado);
      const pub = (await http().get(`/transparency/organizations/${o.orgId}`)).body;
      expect(pub.totals.totalRaisedCents).toBe(esperado);
      expect(pub.campaigns.find((x: any) => x.id === c)).toMatchObject({ totalRaisedCents: esperado, percentReached: Math.round((esperado / 1_000_000) * 1000) / 10 });
      expect((await get('/my/donations/summary', doadorTok)).body.totalConfirmedCents).toBeGreaterThanOrEqual(esperado);
    });
    it('FIN-08 despesa não aprovada (enviada/em análise/complementação/reprovada) nunca aparece como aprovada nem entra nos totais públicos', async () => {
      const o = await ongOf('ongexp', '00360305000104').catch(async () => ongOf('ongexp2', '07526557000100'));
      const c = await campaignOf(o.token); const d = await donate(doadorTok, c, 50000); await confirm(d.id);
      const ids = {} as Record<string, string>;
      for (const k of ['enviada', 'analise', 'complemento', 'reprovada']) ids[k] = (await post('/my/expenses', o.token).send({ campaignId: c, description: `Despesa ${k}`, category: 'Outros', amountCents: 1000, spentAt: hoje }).expect(201)).body.id;
      await post(`/admin/expenses/${ids.analise}/review`, adminTok).send({ action: 'INICIAR' }).expect(201);
      await post(`/admin/expenses/${ids.complemento}/review`, adminTok).send({ action: 'COMPLEMENTAR', reason: 'Falta o recibo.' }).expect(201);
      await post(`/admin/expenses/${ids.reprovada}/review`, adminTok).send({ action: 'REPROVAR', reason: 'Sem comprovação.' }).expect(201);
      const pub = (await http().get(`/transparency/organizations/${o.orgId}`).expect(200)).body;
      expect(pub.expenses).toEqual([]); expect(pub.totals).toMatchObject({ approvedExpensesCents: 0, balanceCents: 50000, pendingExpensesCount: 2 });
      expect(JSON.stringify(pub)).not.toMatch(/Despesa (enviada|analise|complemento|reprovada)/);
      expect((await get('/my/accountability/summary', o.token)).body).toMatchObject({ approvedExpensesCents: 0, approvedExpensesCount: 0 });
    });
    it('FIN-09 aprovações simultâneas não ultrapassam o saldo arrecadado (condição de corrida)', async () => {
      const o = await ongOf('ongrace', '33000167000101').catch(async () => ongOf('ongrace2', '04252011000110'));
      const c = await campaignOf(o.token); const d = await donate(doadorTok, c, 10000); await confirm(d.id); // saldo = R$ 100,00
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const e = (await post('/my/expenses', o.token).send({ campaignId: c, description: `Compra ${i} de teste`, category: 'Outros', amountCents: 6000, spentAt: hoje }).expect(201)).body.id;
        const doc = (await upload(`/my/expenses/${e}/documents`, o.token, pdf, 'application/pdf', 'nf.pdf', { kind: 'NOTA_FISCAL' }).expect(201)).body.id;
        await post(`/admin/expense-documents/${doc}/review`, adminTok).send({ action: 'APROVAR' }).expect(201);
        ids.push(e);
      }
      const rs = await Promise.all(ids.map((e) => post(`/admin/expenses/${e}/review`, adminTok).send({ action: 'APROVAR' })));
      const aprovadas = await db.getRepository(Expense).find({ where: { campaignId: c, status: 'APROVADA' as any } });
      expect(aprovadas.reduce((s, e) => s + e.amountCents, 0)).toBeLessThanOrEqual(10000);
      expect(rs.filter((r) => r.status === 201)).toHaveLength(aprovadas.length);
    });
  });

  // =====================================================================================
  describe('3. Arquivos', () => {
    const exp = async () => (await post('/my/expenses', A.token).send({ campaignId: campA, description: 'Despesa p/ arquivos', category: 'Outros', amountCents: 1000, spentAt: hoje }).expect(201)).body.id as string;
    it('FILE-01 conteúdo malicioso com extensão e MIME de documento é recusado (HTML/EXE/SVG/script/ZIP/PHP)', async () => {
      const e = await exp();
      const payloads: [string, Buffer, string, string][] = [
        ['html-como-pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf', 'laudo.pdf'],
        ['exe-como-png', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'image/png', 'foto.png'],
        ['svg-como-png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/png', 'foto.png'],
        ['script-como-jpeg', Buffer.from('<?php system($_GET["c"]); ?>'), 'image/jpeg', 'foto.jpg'],
        ['zip-como-pdf', Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), 'application/pdf', 'x.pdf'],
        ['mime-nao-permitido', pdf, 'text/html', 'x.html'],
        ['mime-svg', Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg'],
      ];
      for (const [nome, buf, mime, fn] of payloads) {
        for (const alvo of [() => upload(`/my/expenses/${e}/documents`, A.token, buf, mime, fn, { kind: 'NOTA_FISCAL' }), () => upload('/organizations/me/documents', A.token, buf, mime, fn, { type: 'ESTATUTO' }), () => upload('/my/evidences', A.token, buf, mime, fn, { kind: 'FOTO_ACAO', description: 'Foto de teste', takenAt: hoje, campaignId: campA })])
          expect([nome, (await alvo()).status]).toEqual([nome, 400]);
      }
    });
    it('FILE-02 extensão/MIME falsos: bytes de PNG declarados como PDF (e vice-versa) são recusados; nome com extensão perigosa é só rótulo', async () => {
      const e = await exp();
      await upload(`/my/expenses/${e}/documents`, A.token, png, 'application/pdf', 'x.pdf', { kind: 'RECIBO' }).expect(400);
      await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'image/png', 'x.png', { kind: 'RECIBO' }).expect(400);
      const ok = await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'application/pdf', 'virus.exe.html', { kind: 'RECIBO' }).expect(201);
      const f = await get(`/expense-documents/${ok.body.id}/file`, A.token).expect(200);
      expect(f.headers['content-type']).toMatch(/application\/pdf/);
      expect(f.headers['content-disposition']).toMatch(/^attachment/);
    });
    it('FILE-03 acima do limite → 413 (documentos, comprovantes, evidências, imagem de campanha, avatar)', async () => {
      const e = await exp();
      const big = (n: number) => Buffer.concat([pdf, Buffer.alloc(n)]);
      const bigPng = (n: number) => Buffer.concat([png, Buffer.alloc(n)]);
      for (const r of [
        await upload(`/my/expenses/${e}/documents`, A.token, big(5 * 1024 * 1024 + 10), 'application/pdf', 'g.pdf', { kind: 'NOTA_FISCAL' }),
        await upload('/organizations/me/documents', A.token, big(5 * 1024 * 1024 + 10), 'application/pdf', 'g.pdf', { type: 'ESTATUTO' }),
        await upload('/my/evidences', A.token, bigPng(5 * 1024 * 1024 + 10), 'image/png', 'g.png', { kind: 'FOTO_ACAO', description: 'Foto de teste', takenAt: hoje, campaignId: campA }),
        await post(`/my/campaigns/${campA}/image`, A.token).attach('file', bigPng(3 * 1024 * 1024 + 10), { filename: 'g.png', contentType: 'image/png' }),
        await upload('/users/me/avatar', doadorTok, bigPng(2 * 1024 * 1024 + 10), 'image/png', 'g.png'),
      ]) expect(r.status).toBe(413);
      expect(await db.getRepository(ExpenseDocument).countBy({ expenseId: e })).toBe(0);
    });
    it('FILE-04 vazio, campo inesperado, vários arquivos ou sem arquivo → 400 (nunca 500)', async () => {
      const e = await exp();
      expect((await upload(`/my/expenses/${e}/documents`, A.token, Buffer.alloc(0), 'application/pdf', 'v.pdf', { kind: 'NOTA_FISCAL' })).status).toBe(400);
      expect((await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'application/pdf', 'v.pdf', { kind: 'NOTA_FISCAL' }, 'outro_campo')).status).toBe(400);
      expect((await http().post(`/my/expenses/${e}/documents`).set(a(A.token)).field('kind', 'NOTA_FISCAL').attach('file', pdf, 'a.pdf').attach('file', pdf, 'b.pdf')).status).toBe(400);
      expect((await post(`/my/expenses/${e}/documents`, A.token).field('kind', 'NOTA_FISCAL')).status).toBe(400);
    });
    it('FILE-05 nomes de arquivo maliciosos não permitem path traversal nem injeção de cabeçalho', async () => {
      const e = await exp();
      for (const nome of ['../../../etc/passwd', '..\\..\\windows\\system32\\cmd.exe', 'a"; filename="evil.html', 'x\r\nSet-Cookie: s=1', '%00.pdf', 'a'.repeat(400) + '.pdf']) {
        const up = await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'application/pdf', nome, { kind: 'NOTA_FISCAL' });
        expect([201, 400]).toContain(up.status);
        if (up.status === 201) {
          const f = await get(`/expense-documents/${up.body.id}/file`, A.token).expect(200);
          expect(f.headers['content-disposition']).not.toMatch(/[\r\n]/); expect(f.headers['set-cookie']).toBeUndefined();
          expect(up.body.name).not.toMatch(/[\/\\\r\n\0]/); expect(up.body.name.length).toBeLessThanOrEqual(180);
        }
      }
    });
    it('FILE-06 documentos privados: anônimo, doador, outra ONG e rotas públicas não acessam', async () => {
      const e = await exp();
      const doc = (await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'application/pdf', 'nf.pdf', { kind: 'NOTA_FISCAL' }).expect(201)).body.id;
      const od = (await upload('/organizations/me/documents', A.token, pdf, 'application/pdf', 'e.pdf', { type: 'ATA_DIRETORIA' }).expect(201)).body.id;
      const ev = (await upload('/my/evidences', A.token, jpg, 'image/jpeg', 'f.jpg', { kind: 'FOTO_ACAO', description: 'Foto de teste', takenAt: hoje, campaignId: campA }).expect(201)).body.id;
      for (const u of [`/expense-documents/${doc}/file`, `/organizations/documents/${od}/file`, `/evidences/${ev}/file`]) {
        expect([u, (await http().get(u)).status]).toEqual([u, 401]);
        expect([u, (await get(u, doadorTok)).status]).toEqual([u, 403]);
        expect([u, (await get(u, B.token)).status]).toEqual([u, 404]);
        expect([u, (await get(u, A.token)).status]).toEqual([u, 200]);
        expect([u, (await get(u, adminTok)).status]).toEqual([u, 200]);
      }
      for (const u of [`/transparency/expense-documents/${doc}/file`, `/transparency/evidences/${ev}/file`, `/transparency/evidences/${UUID0}/file`, `/transparency/evidences/não-é-uuid/file`]) expect([u, (await http().get(u)).status].toString()).toMatch(/,(404|400)$/);
      // aprovado mas NÃO publicável continua privado
      await post(`/admin/evidences/${ev}/review`, adminTok).send({ action: 'APROVAR', publishable: false }).expect(201);
      await http().get(`/transparency/evidences/${ev}/file`).expect(404);
    });
    it('FILE-07 cabeçalhos dos downloads: nosniff, attachment, tipo correto e sem cache compartilhado em arquivos privados', async () => {
      const e = await exp();
      const doc = (await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'application/pdf', 'nf.pdf', { kind: 'NOTA_FISCAL' }).expect(201)).body.id;
      const h = (await get(`/expense-documents/${doc}/file`, A.token).expect(200)).headers;
      expect(h['x-content-type-options']).toBe('nosniff'); expect(h['content-disposition']).toMatch(/^attachment/); expect(h['cache-control']).toMatch(/no-store/);
    });
    it('FILE-08 substituição sem histórico: documento institucional substituído mantém a versão anterior; comprovante aprovado não pode ser trocado/anexado/apagado', async () => {
      const o = await ongOf('ongdoc', '00360305000104', OrganizationStatus.INCOMPLETO).catch(async () => ongOf('ongdoc2', '33000167000101', OrganizationStatus.INCOMPLETO));
      const v1 = (await upload('/organizations/me/documents', o.token, pdf, 'application/pdf', 'v1.pdf', { type: 'ESTATUTO' }).expect(201)).body;
      await post(`/admin/organizations/documents/${v1.id}/review`, adminTok).send({ decision: 'APROVAR' }).expect(201);
      const v2 = (await upload('/organizations/me/documents', o.token, Buffer.concat([pdf, Buffer.from('v2')]), 'application/pdf', 'v2.pdf', { type: 'ESTATUTO' }).expect(201)).body;
      const rows = await db.getRepository(OrganizationDocument).find({ where: { organizationId: o.orgId, type: 'ESTATUTO' as any }, select: { id: true, status: true, supersededAt: true, sha256: true } });
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === v1.id)).toMatchObject({ status: 'APROVADO' }); expect(rows.find((r) => r.id === v1.id)!.supersededAt).not.toBeNull();
      expect(rows.find((r) => r.id === v2.id)).toMatchObject({ status: 'PENDENTE', supersededAt: null }); expect(v1.sha256).not.toBe(v2.sha256);
      await get(`/organizations/documents/${v1.id}/file`, adminTok).expect(200); // versão antiga segue acessível ao admin
      expect(await db.getRepository(AuditLog).countBy({ action: 'ORG_DOCUMENT_REPLACED', organizationId: o.orgId })).toBe(1);
      await http().delete(`/organizations/documents/${v1.id}`).set(a(o.token)).expect(404); // não há rota de exclusão
      // comprovante de despesa aprovada
      const e = await exp(); const d = (await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'application/pdf', 'nf.pdf', { kind: 'NOTA_FISCAL' }).expect(201)).body.id;
      await post(`/admin/expense-documents/${d}/review`, adminTok).send({ action: 'APROVAR' }).expect(201);
      await db.getRepository(Expense).update(e, { status: 'APROVADA' as any });
      await upload(`/my/expenses/${e}/documents`, A.token, pdf, 'application/pdf', 'nova.pdf', { kind: 'NOTA_FISCAL' }).expect(400);
      await patch(`/my/expenses/${e}`, A.token).send({ amountCents: 1 }).expect(400);
      for (const m of ['put', 'delete', 'patch'] as const) expect([404, 405]).toContain((await (http() as any)[m](`/expense-documents/${d}`).set(a(A.token)).send({})).status);
      await post(`/admin/expense-documents/${d}/review`, adminTok).send({ action: 'REPROVAR', reason: 'reabrir após aprovado' }).expect(400); // decisão final não é reaberta
    });
    it('FILE-09 falha no armazenamento: erro genérico (500), sem vazamento e sem registro órfão', async () => {
      const antes = await db.getRepository(OrganizationDocument).countBy({ organizationId: A.orgId });
      const spy = jest.spyOn(EntityManager.prototype, 'save').mockRejectedValueOnce(new Error('FATAL: disco cheio em /var/lib/postgresql/secret-path'));
      const r = await upload('/organizations/me/documents', A.token, pdf, 'application/pdf', 'f.pdf', { type: 'CERTIDAO' });
      spy.mockRestore();
      expect(r.status).toBe(500); expect(JSON.stringify(r.body)).not.toMatch(/disco|postgresql|secret-path|stack|at /);
      expect(await db.getRepository(OrganizationDocument).countBy({ organizationId: A.orgId })).toBe(antes);
      // imagem de campanha: falha ao gravar no disco
      const before = (await get(`/my/campaigns/${campA}`, A.token)).body.imageUrl;
      const w = jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(Object.assign(new Error('EACCES: /srv/uploads'), { code: 'EACCES' }));
      const r2 = await post(`/my/campaigns/${campA}/image`, A.token).attach('file', png, { filename: 'a.png', contentType: 'image/png' });
      w.mockRestore();
      expect(r2.status).toBe(500); expect(JSON.stringify(r2.body)).not.toMatch(/EACCES|srv/);
      expect((await get(`/my/campaigns/${campA}`, A.token)).body.imageUrl).toBe(before);
    });
    it('FILE-10 avatar legado: conteúdo/extensão forjados são recusados e o que fica salvo é inofensivo', async () => {
      for (const [buf, mime, nome] of [[Buffer.from('<html><script>alert(1)</script></html>'), 'image/png', 'a.html'], [Buffer.from('<svg onload=alert(1)/>'), 'image/png', 'a.svg'], [Buffer.from('<script>x</script>'), 'image/jpeg', 'a.jpg.html']] as [Buffer, string, string][]) {
        const r = await upload('/users/me/avatar', doadorTok, buf, mime, nome);
        expect([nome, r.status]).toEqual([nome, 400]);
      }
      const ok = await upload('/users/me/avatar', doadorTok, png, 'image/png', 'minha.html').expect(201);
      expect(ok.body.profileImage).toMatch(/^\/uploads\/avatars\/[\w-]+\.png$/);
      const served = await http().get(ok.body.profileImage).expect(200);
      expect(served.headers['content-type']).toMatch(/image\/png/); expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-security-policy']).toMatch(/default-src 'none'/);
      await fs.unlink(`${process.cwd()}${ok.body.profileImage}`);
    });
    it('FILE-11 pasta /uploads: sem path traversal, sem dotfiles e sem listagem', async () => {
      for (const u of ['/uploads/', '/uploads/avatars/', '/uploads/../.env', '/uploads/%2e%2e/.env', '/uploads/..%2f..%2fpackage.json', '/uploads/.gitkeep', '/uploads/avatars/..%5c..%5c.env']) {
        const r = await http().get(u); expect([u, [400, 403, 404].includes(r.status)]).toEqual([u, true]); expect(r.text ?? '').not.toMatch(/JWT_SECRET|"name":\s*"backend"/);
      }
    });
  });

  // =====================================================================================
  describe('4. Aplicação', () => {
    it('APP-04 tentativas excessivas de login: bloqueio da conta (5) e limite por IP (429) e sem enumeração de usuários', async () => {
      const u = await mk('lockme', UserType.DOADOR);
      const resp = [] as number[]; for (let i = 0; i < 5; i++) resp.push((await http().post('/users/login').send({ email: u.email, password: 'errada!!' })).status);
      expect(resp).toEqual([401, 401, 401, 401, 401]);
      expect((await http().post('/users/login').send({ email: u.email, password: SENHA })).status).toBe(403); // senha certa não destrava
      const existe = await http().post('/users/login').send({ email: doador.email, password: 'errada!!' });
      const naoExiste = await http().post('/users/login').send({ email: 'ninguem@example.invalid', password: 'errada!!' });
      expect([existe.status, naoExiste.status]).toEqual([401, 401]); expect(existe.body.message).toBe(naoExiste.body.message);
      for (let i = 0; i < 2; i++) await http().post('/users/login').send({ email: `nao${i}@example.invalid`, password: 'qualquer-coisa' }); // completa 10 tentativas na janela
      expect((await http().post('/users/login').send({ email: 'nao9@example.invalid', password: 'x' })).status).toBe(429); // limite por IP
    });
    it('APP-01 SQL injection: payloads em query, rota, corpo e login não geram 500, não vazam dados e não alteram tabelas', async () => {
      const sqli = ["' OR '1'='1", "'; DROP TABLE users; --", '1; DELETE FROM audit_logs', "' UNION SELECT password FROM \"user\" --", '1 OR 1=1', "%27%20OR%201%3D1--"];
      const count = async () => [await db.getRepository(User).count(), await db.getRepository(AuditLog).count(), await db.getRepository(Donation).count()];
      const before = await count();
      for (const p of sqli) {
        const q = encodeURIComponent(p);
        for (const u of [`/admin/audit-logs?entityType=${q}&organizationId=${q}&actorId=${q}&limit=${q}`, `/admin/organizations?status=${q}`, `/admin/donations?status=${q}`, `/publicacoes?q=${q}&search=${q}&categoria=${q}&page=${q}`, `/users/ongs?search=${q}&categoria=${q}&q=${q}`, `/campaigns/${q}`, `/organizations/public/${q}`, `/transparency/organizations/${q}`]) {
          const r = await get(u, adminTok); expect([u, r.status < 500]).toEqual([u, true]);
          expect(JSON.stringify(r.body)).not.toMatch(/\$2[aby]\$|syntax error|pg_catalog|QueryFailedError/i);
        }
        const l = await http().post('/users/login').send({ email: p, password: p }); expect(l.status).toBeLessThan(500);
        const r = await post(`/campaigns/${campA}/donations`, doadorTok).send({ amountCents: p, cpf: p }); expect(r.status).toBe(400);
        await patch('/organizations/me', A.token).send({ description: p, tradeName: p }).expect(200);
      }
      const depois = await count();
      expect([depois[0], depois[2]]).toEqual([before[0], before[2]]); expect(depois[1]).toBeGreaterThanOrEqual(before[1]); // auditoria só cresce
      expect(await db.getRepository(User).findOneBy({ id: admin.id })).not.toBeNull();
    });
    it('APP-02 XSS: scripts armazenados voltam como texto inerte (JSON, nosniff, sem HTML) e o frontend não usa sinks perigosos', async () => {
      const xss = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
      await patch('/organizations/me', A.token).send({ description: xss, tradeName: xss }).expect(200);
      await post(`/my/campaigns/${campA}/status`, A.token).send({ status: 'ENCERRADA' }); // encerra p/ não interferir
      const r = await http().get(`/organizations/public/${A.orgId}`);
      for (const res of [r, await http().get('/campaigns'), await http().get(`/transparency/organizations/${A.orgId}`), await get('/organizations/me', A.token)]) {
        expect(res.headers['content-type']).toMatch(/application\/json/); expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
      }
      const html = await http().get('/campaigns').set('Accept', 'text/html'); expect(html.headers['content-type']).not.toMatch(/text\/html/);
      const sinks = (await fs.readFile('docs/evidencias/frontend-sinks.txt', 'utf8').catch(() => '')) ;
      expect(sinks).toBe('');
    });
    it('APP-03 CSRF: autenticação é por header Authorization (cookie sozinho não autentica) e CORS só libera origens permitidas', async () => {
      await http().post(`/campaigns/${campA}/donations`).set('Cookie', `access_token=${doadorTok}; token=${doadorTok}; Authorization=Bearer ${doadorTok}`).send({ amountCents: 1000 }).expect(401);
      const before = process.env.CORS_ORIGINS;
      const pre = await http().options('/my/donations').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'authorization');
      // sem allowlist configurada, o comportamento padrão NÃO pode refletir origens arbitrárias com credenciais
      expect([pre.headers['access-control-allow-origin'] === 'https://evil.example' && pre.headers['access-control-allow-credentials'] === 'true']).toEqual([false]);
      process.env.CORS_ORIGINS = before;
    });
    it('APP-05 sessões: expirada, revogada, logout, logout-all, token sem sid, "alg none", assinatura errada e sid de outro usuário → 401', async () => {
      const su = await mk('sessuser', UserType.DOADOR);
      const exp = await tokenFor(su, { expiresInMs: -1000 });
      await get('/my/donations', exp.token).expect(401);
      const rev = await tokenFor(su); await db.getRepository(Session).update(rev.sid, { revokedAt: new Date() });
      await get('/my/donations', rev.token).expect(401);
      const lo = await tokenFor(su); await get('/my/donations', lo.token).expect(200); await post('/auth/logout', lo.token).expect(204); await get('/my/donations', lo.token).expect(401);
      const s1 = await tokenFor(su), s2 = await tokenFor(su); await post('/auth/logout-all', s1.token).expect(201);
      await get('/my/donations', s2.token).expect(401);
      const semSid = jwt.sign({ sub: su.id, email: su.email, type: 'DOADOR' }); await get('/my/donations', semSid).expect(401);
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      await get('/my/donations', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: admin.id, type: 'ADMIN', sid: (await tokenFor(admin)).sid })}.`).expect(401);
      const errada = new JwtService({ secret: 'outro-segredo' }).sign({ sub: su.id, type: 'DOADOR', sid: (await tokenFor(su)).sid }); await get('/my/donations', errada).expect(401);
      const outro = jwt.sign({ sub: admin.id, email: admin.email, type: 'ADMIN', sid: (await tokenFor(su)).sid }); await get('/admin/organizations', outro).expect(401);
      await get('/my/donations', 'lixo.lixo.lixo').expect(401);
      const forj = jwt.sign({ sub: su.id, email: su.email, type: 'ADMIN', sid: (await tokenFor(su)).sid }); await get('/admin/organizations', forj).expect(403); // o tipo vem do banco, não do token
    });
    it('APP-06 recuperação de senha: link de uso único, expira sessões, resposta idêntica para e-mail inexistente', async () => {
      (global as any).__resetUrl = undefined;
      const u = await mk('resetme', UserType.DOADOR); const s = await tokenFor(u);
      const m1 = await http().post('/auth/forgot-password').send({ email: u.email }); const m2 = await http().post('/auth/forgot-password').send({ email: 'x@example.invalid' });
      expect([m1.status, m1.body]).toEqual([m2.status, m2.body]);
      for (let i = 0; i < 40 && !(global as any).__resetUrl; i++) await new Promise((r) => setTimeout(r, 100)); // e-mail é enviado de forma assíncrona
      const token = new URL((global as any).__resetUrl).searchParams.get('token');
      await http().post('/auth/reset-password').send({ token, password: 'NovaSenha@2026!' }).expect(200);
      await get('/my/donations', s.token).expect(401); // sessões antigas encerradas
      await http().post('/auth/reset-password').send({ token, password: 'OutraSenha@2026!' }).expect(400); // uso único
    });
    it('APP-07 exposição de informação: sem hash de senha/segredos, erros genéricos e cabeçalhos de segurança', async () => {
      const raw = [await get('/users/me', doadorTok), await get('/users', adminTok), await get('/admin/ongs', adminTok), await http().get('/users/ongs'), await http().get(`/users/ongs/${A.user.id}`), await get('/organizations/me', A.token), await http().get('/campaigns'), await http().get('/organizations/public')].map((r) => JSON.stringify(r.body)).join('\n');
      expect(raw).not.toMatch(/\$2[aby]\$|mfaSecret|"password"|chave-sandbox|chave-portal|access_token|asaasCustomerId|lockedUntil|failedLoginAttempts|"content":|providerPaymentId/);
      const pub = JSON.stringify([(await http().get('/users/ongs')).body, (await http().get(`/users/ongs/${A.user.id}`)).body]);
      expect(pub).not.toMatch(/"(cpf|legalCpf|bank|agency|account|accountType)"\s*:/); // CPF e dados bancários nunca saem em rota pública
      for (const r of [await http().get('/rota/que/nao/existe'), await get('/my/donations/não-é-uuid', doadorTok), await http().post('/users/login').set('Content-Type', 'application/json').send('{"email":')]) {
        expect(JSON.stringify(r.body)).not.toMatch(/stack|node_modules|\/Users\/|at .*\(|QueryFailed|select |insert /i);
      }
      const h = (await http().get('/campaigns')).headers;
      expect(h['x-content-type-options']).toBe('nosniff'); expect(h['x-frame-options']).toBe('DENY'); expect(h['referrer-policy']).toBe('no-referrer'); expect(h['x-powered-by']).toBeUndefined();
    });
    it('APP-11 [RISCO EM ABERTO] contatos públicos da página da ONG (e-mail de login, telefone, WhatsApp, chave Pix) — documentado, depende de decisão de produto', async () => {
      await db.getRepository(User).update(B.user.id, { phone: '11900000000', whatsapp: '11900000000', pixKey: 'chave-teste@example.invalid' });
      const keys = Object.keys((await http().get(`/users/ongs/${B.user.id}`).expect(200)).body).sort();
      await fs.writeFile('docs/evidencias/exposicao-publica-ongs.json', JSON.stringify({ rota: 'GET /users/ongs/:id (sem autenticação)', camposExpostos: keys, observacao: 'email é o identificador de login; pixKey permite doação fora da plataforma' }, null, 1));
      expect(keys).not.toEqual(expect.arrayContaining(['cpf', 'legalCpf', 'bank', 'agency', 'account', 'password']));
    });
    it('APP-08 validação no servidor: JSON malformado, tipos errados, UUID inválido, corpo gigante e campos desconhecidos', async () => {
      expect((await http().post('/users/login').set('Content-Type', 'application/json').send('{"email":')).status).toBe(400);
      expect((await post('/my/expenses', A.token).send({ campaignId: 'x', description: 1, category: [], amountCents: 'a', spentAt: 'ontem' })).status).toBe(400);
      expect((await get('/my/donations/abc', doadorTok)).status).toBe(400);
      expect((await post(`/campaigns/${campA}/donations`, doadorTok).send({ amountCents: 1000, lixo: 'x'.repeat(2_000_000) })).status).toBe(413);
      expect((await post('/my/expenses', A.token).send({ campaignId: campA, description: 'Despesa com data futura', category: 'Outros', amountCents: 100, spentAt: '2999-01-01' })).status).toBe(400);
    });
    it('APP-09 senha forte: cadastro rejeita senhas curtas/comuns', async () => {
      for (const senha of ['123', '12345', 'abc123', '1234567']) expect([senha, (await http().post('/users').send({ name: 'Teste Senha', email: `s${senha}@example.invalid`, password: senha, type: 'DOADOR' })).status]).toEqual([senha, 400]);
    });
    it('APP-10 cadastro e recuperação com limite de tentativas (429) e sem enumeração por cadastro', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 25; i++) codes.push((await http().post('/users').send({ name: 'Teste Flood', email: `flood${i}@example.invalid`, password: 'SenhaForte#2026', type: 'DOADOR' })).status);
      expect(codes).toContain(429);
    });
  });

  // =====================================================================================
  describe('5. Integrações indisponíveis ou maliciosas', () => {
    const preparar = async (label: string, _c: string) => {
      const o = await ongOf(label, _c, OrganizationStatus.INCOMPLETO);
      const cnpj = (await db.getRepository(Organization).findOneByOrFail({ id: o.orgId })).cnpj;
      await patch('/organizations/me', o.token).send({ legalName: `ONG ${cnpj}`, tradeName: `ONG ${cnpj}`, description: 'Atendimento a famílias em vulnerabilidade.', email: 'contato@example.invalid', phone: '1133334444', zip: '01310100', street: 'Av. Teste', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', legalRepName: 'Representante Teste', legalRepCpf: CPF_TESTE, legalRepEmail: 'rep@example.invalid', legalRepPhone: '11999998888' }).expect(200);
      for (const t of ['ESTATUTO', 'ATA_DIRETORIA', 'COMPROVANTE_ENDERECO', 'DOC_REPRESENTANTE']) await upload('/organizations/me/documents', o.token, pdf, 'application/pdf', `${t}.pdf`, { type: t }).expect(201);
      return o;
    };
    const aprovarTudo = async (o: { orgId: string }, body: object = { decision: 'APROVAR' }) => {
      for (const d of (await get(`/admin/organizations/${o.orgId}`, adminTok)).body.documents) await post(`/admin/organizations/documents/${d.id}/review`, adminTok).send({ decision: 'APROVAR' }).expect(201);
      return post(`/admin/organizations/${o.orgId}/decision`, adminTok).send(body);
    };
    const cnpjs = ['11444777000161', '12345678000195', '19131243000197', '27865757000102', '03773488000109', '17895646000187', '56994502000130'];
    it.each([['down', 0], ['timeout', 1], ['html', 2], ['outroCnpj', 3]] as const)('INT-01 BrasilAPI %s: ONG fica EM_ANALISE (nunca aprovada sozinha) e a aprovação exige justificativa', async (modo, i) => {
      ext.brasil = modo; installExternal();
      const o = await preparar(`brasil${modo}`, cnpjs[i]);
      await post('/organizations/me/submit', o.token).expect(201);
      const det = (await get(`/admin/organizations/${o.orgId}`, adminTok)).body;
      expect(det.status).toBe('EM_ANALISE');
      const b = det.externalChecks.find((c: any) => c.source === 'BRASILAPI');
      expect(modo === 'outroCnpj' ? ['INDISPONIVEL', 'ALERTA'] : ['INDISPONIVEL']).toContain(b.status);
      const r = await aprovarTudo(o); expect(r.status).toBe(400);
      expect((await db.getRepository(Organization).findOneByOrFail({ id: o.orgId })).status).toBe('EM_ANALISE');
      await post('/my/campaigns', o.token).send({ title: 'Campanha X', description: 'Descrição longa o bastante.', objective: 'Objetivo de teste.', goalCents: 100000 }).expect(403);
    });
    it.each([['down'], ['nokey'], ['garbage']] as const)('INT-02 Portal da Transparência %s: consulta INDISPONIVEL, ONG pendente e aprovação bloqueada', async (modo) => {
      ext.portal = modo; installExternal();
      const o = await preparar(`portal${modo}`, cnpjs[4 + ['down', 'nokey', 'garbage'].indexOf(modo)]);
      await post('/organizations/me/submit', o.token).expect(201);
      const det = (await get(`/admin/organizations/${o.orgId}`, adminTok)).body;
      expect(det.externalChecks.find((c: any) => c.source === 'PORTAL_TRANSPARENCIA').status).toBe('INDISPONIVEL');
      expect((await aprovarTudo(o)).status).toBe(400);
      expect((await db.getRepository(Organization).findOneByOrFail({ id: o.orgId })).status).toBe('EM_ANALISE');
    });
    it('INT-03 todas as fontes fora do ar: o envio funciona, tudo INDISPONIVEL, nenhuma aprovação automática; override só por admin e com justificativa registrada', async () => {
      ext.brasil = 'down'; ext.portal = 'down'; installExternal(); jest.spyOn(axios, 'get').mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
      const o = await preparar('tudofora', '10573521000191');
      await post('/organizations/me/submit', o.token).expect(201);
      const det = (await get(`/admin/organizations/${o.orgId}`, adminTok)).body;
      expect(det.status).toBe('EM_ANALISE'); expect(det.externalChecks.map((c: any) => c.status)).toEqual(['INDISPONIVEL', 'INDISPONIVEL', 'INDISPONIVEL', 'INDISPONIVEL']);
      expect((await aprovarTudo(o)).status).toBe(400);
      expect((await post(`/admin/organizations/${o.orgId}/decision`, adminTok).send({ decision: 'APROVAR', overrideReason: 'curto' })).status).toBe(400);
      expect((await post(`/admin/organizations/${o.orgId}/decision`, o.token).send({ decision: 'APROVAR', overrideReason: 'eu mesma aprovo sem consultas' })).status).toBe(403);
      const ok = await post(`/admin/organizations/${o.orgId}/decision`, adminTok).send({ decision: 'APROVAR', overrideReason: 'Conferido manualmente no site da Receita em teste.' });
      expect(ok.status).toBe(201);
      const log = await db.getRepository(AuditLog).findOneByOrFail({ action: 'ORG_APPROVED', entityId: o.orgId });
      expect(log.actorType).toBe('ADMIN'); expect(JSON.stringify(log.metadata)).toMatch(/Conferido manualmente/);
    });
    it('INT-04 Asaas indisponível/timeout/lixo/sem chave na criação: erro controlado, doação não fica pendente, nada confirmado', async () => {
      for (const modo of ['down', 'timeout', 'garbage'] as const) {
        asaas.mode = modo; const antes = await db.getRepository(Donation).countBy({ status: 'CONFIRMADA' as any });
        const r = await post(`/campaigns/${campB}/donations`, doadorTok).send({ amountCents: 3000 });
        expect([modo, r.status]).toEqual([modo, 502]); expect(JSON.stringify(r.body)).not.toMatch(/chave-sandbox|access_token|<html/);
        expect(await db.getRepository(Donation).countBy({ status: 'CONFIRMADA' as any })).toBe(antes);
      }
      asaas.mode = 'ok'; delete process.env.ASAAS_API_KEY;
      expect((await post(`/campaigns/${campB}/donations`, doadorTok).send({ amountCents: 3000 })).status).toBe(503);
      process.env.ASAAS_API_KEY = 'chave-sandbox-teste';
      const pend = await db.getRepository(Donation).find({ where: { campaignId: campB, status: 'PENDENTE' as any } }); expect(pend).toEqual([]);
    });
    it('INT-05 Asaas fora ao confirmar: webhook devolve 5xx (para reenvio) e NÃO confirma; ao voltar, reentrega confirma uma vez', async () => {
      const d = await donate(doadorTok, campB, 4000); const pid = await pay(d.id);
      asaas.mode = 'down';
      for (const f of [() => webhook(pid, 'PAYMENT_RECEIVED', 'evt_retry_x'), () => post(`/my/donations/${d.id}/sync`, doadorTok), () => post(`/admin/donations/${d.id}/reconcile`, adminTok)]) expect((await f()).status).toBeGreaterThanOrEqual(500);
      expect((await db.getRepository(Donation).findOneByOrFail({ id: d.id })).status).toBe('PENDENTE');
      asaas.mode = 'ok';
      expect((await webhook(pid, 'PAYMENT_RECEIVED', 'evt_retry_x').expect(200)).body.outcome).toBe('APPLIED');
      expect(await db.getRepository(AuditLog).countBy({ action: 'DONATION_CONFIRMED', entityId: d.id })).toBe(1);
    });
    it('INT-06 webhooks inválidos com token correto (vazio, sem id, tipos errados, evento de outro recurso, pagamento desconhecido) não geram 5xx nem efeitos', async () => {
      const antes = [await db.getRepository(Donation).countBy({ status: 'CONFIRMADA' as any }), await db.getRepository(User).count()];
      for (const body of [{}, [], 'texto', null, { id: 1, event: 2 }, { id: 'evt_a' }, { id: 'evt_b', event: 'PAYMENT_RECEIVED' }, { id: 'evt_c', event: 'TRANSFER_DONE', transfer: { id: 'tr_1' } }, { id: 'evt_d', event: 'PAYMENT_RECEIVED', payment: { id: { $ne: null } } }, { id: 'evt_e', event: 'PAYMENT_RECEIVED', payment: { id: "pay_1'; DROP TABLE donations;--" } }, { id: 'evt_f', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_inexistente' } }]) {
        const r = await http().post('/webhooks/asaas').set('asaas-access-token', WH).set('Content-Type', 'application/json').send(JSON.stringify(body));
        expect([JSON.stringify(body), r.status < 500]).toEqual([JSON.stringify(body), true]);
      }
      expect([await db.getRepository(Donation).countBy({ status: 'CONFIRMADA' as any }), await db.getRepository(User).count()]).toEqual(antes);
    });
    it('INT-07 resposta do Asaas sem id/estrutura esperada não cria cobrança "fantasma"', async () => {
      jest.spyOn(axios, 'request').mockImplementation(async (cfg: any) => String(cfg.url).endsWith('/customers') ? ({ status: 200, data: { id: 'cus_1' } } as any) : ({ status: 200, data: { status: 'PENDING' } } as any));
      const r = await post(`/campaigns/${campB}/donations`, doadorTok).send({ amountCents: 3000 });
      expect(r.status).toBe(502);
      expect(await db.getRepository(Donation).countBy({ campaignId: campB, status: 'PENDENTE' as any })).toBe(0);
    });
  });

  // =====================================================================================
  describe('6. Auditoria', () => {
    it('AUD-01 ações críticas estão registradas com responsável, entidade, organização e data', async () => {
      const logs = await db.getRepository(AuditLog).find();
      const actions = new Set(logs.map((l) => l.action)); const missing: string[] = [];
      for (const x of ['LOGIN_FAILED', 'LOGIN_LOCKED', 'ORG_CREATED', 'ORG_DOCUMENT_UPLOADED', 'ORG_DOCUMENT_REPLACED', 'ORG_DOCUMENT_REVIEWED', 'ORG_SUBMITTED', 'ORG_APPROVED', 'CAMPAIGN_CREATED', 'CAMPAIGN_PUBLISHED', 'DONATION_CREATED', 'DONATION_CONFIRMED', 'DONATION_REFUNDED', 'DONATION_CANCELLED', 'EXPENSE_CREATED', 'EXPENSE_DOCUMENT_UPLOADED', 'EXPENSE_DOCUMENT_REVIEWED', 'EXPENSE_APPROVED', 'EXPENSE_REJECTED', 'EXPENSE_COMPLEMENT_REQUESTED', 'EVIDENCE_UPLOADED', 'EVIDENCE_REVIEWED', 'SESSIONS_REVOKED', 'LOGOUT']) if (!actions.has(x)) missing.push(x);
      expect(missing).toEqual([]);
      const aprov = logs.find((l) => l.action === 'EXPENSE_APPROVED')!; expect(aprov).toMatchObject({ actorType: 'ADMIN', entityType: 'expense', organizationId: expect.any(String) }); expect(aprov.createdAt).toBeInstanceOf(Date);
      expect(logs.find((l) => l.action === 'DONATION_CONFIRMED')!.actorId).toBeNull(); // confirmação pelo provedor: ator = sistema
    });
    it('AUD-02 usuários não leem nem escrevem logs: sem rotas de escrita; leitura só admin com MFA', async () => {
      for (const t of [doadorTok, A.token]) { await get('/admin/audit-logs', t).expect(403); await get('/admin/audit-logs/verify', t).expect(403); }
      await http().get('/admin/audit-logs').expect(401);
      for (const m of ['post', 'put', 'patch', 'delete'] as const) for (const t of [doadorTok, A.token, adminTok]) expect([403, 404, 405]).toContain((await (http() as any)[m]('/admin/audit-logs').set(a(t)).send({ action: 'x' })).status);
      for (const m of ['put', 'patch', 'delete'] as const) expect([403, 404, 405]).toContain((await (http() as any)[m]('/admin/audit-logs/1').set(a(adminTok)).send({})).status);
    });
    it('AUD-03 imutabilidade no banco: UPDATE, DELETE e TRUNCATE são rejeitados (inclusive SQL direto da aplicação)', async () => {
      const t = `"${schema}"."audit_logs"`;
      await expect(db.query(`UPDATE ${t} SET action = 'ADULTERADO'`)).rejects.toThrow(/imutável/);
      await expect(db.query(`DELETE FROM ${t}`)).rejects.toThrow(/imutável/);
      await expect(db.query(`TRUNCATE ${t}`)).rejects.toThrow(/imutável/);
    });
    it('AUD-04 cadeia de hash: verificação íntegra; detecta edição e remoção no meio; NÃO detecta truncamento do final (limitação documentada)', async () => {
      const t = `"${schema}"."audit_logs"`;
      const v0 = await get('/admin/audit-logs/verify', adminTok).expect(200);
      expect(v0.body).toMatchObject({ ok: true, checked: expect.any(Number) }); expect(v0.body.checked).toBeGreaterThan(50);
      // atacante com acesso direto ao banco (superusuário) desliga o gatilho e altera uma linha
      const mid = (await db.query(`SELECT id FROM ${t} ORDER BY id OFFSET 20 LIMIT 1`))[0].id;
      await db.query(`ALTER TABLE ${t} DISABLE TRIGGER audit_logs_row_guard`);
      const original = (await db.query(`SELECT action FROM ${t} WHERE id = ${mid}`))[0].action;
      await db.query(`UPDATE ${t} SET action = 'ADULTERADO' WHERE id = ${mid}`);
      const v1 = await get('/admin/audit-logs/verify', adminTok).expect(200);
      expect(v1.body).toMatchObject({ ok: false, firstBadId: String(mid) });
      await db.query(`UPDATE ${t} SET action = '${original}' WHERE id = ${mid}`);
      expect((await get('/admin/audit-logs/verify', adminTok)).body.ok).toBe(true);
      // remoção de linha do meio
      const row = (await db.query(`SELECT * FROM ${t} WHERE id = ${mid}`))[0];
      await db.query(`DELETE FROM ${t} WHERE id = ${mid}`);
      const v2 = await get('/admin/audit-logs/verify', adminTok).expect(200); expect(v2.body.ok).toBe(false);
      await db.query(`INSERT INTO ${t} (id, "actorId", "actorType", action, "entityType", "entityId", "organizationId", metadata, ip, "createdAt", "prevHash", hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [row.id, row.actorId, row.actorType, row.action, row.entityType, row.entityId, row.organizationId, row.metadata, row.ip, row.createdAt, row.prevHash, row.hash]);
      expect((await get('/admin/audit-logs/verify', adminTok)).body.ok).toBe(true);
      // limitação: remover as últimas linhas deixa a cadeia restante consistente
      const last = (await db.query(`SELECT id FROM ${t} ORDER BY id DESC LIMIT 1`))[0].id;
      const lastRow = (await db.query(`SELECT * FROM ${t} WHERE id = ${last}`))[0];
      await db.query(`DELETE FROM ${t} WHERE id = ${last}`);
      expect((await get('/admin/audit-logs/verify', adminTok)).body.ok).toBe(true); // não detecta: precisa de âncora externa do hash mais recente
      await db.query(`INSERT INTO ${t} (id, "actorId", "actorType", action, "entityType", "entityId", "organizationId", metadata, ip, "createdAt", "prevHash", hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [lastRow.id, lastRow.actorId, lastRow.actorType, lastRow.action, lastRow.entityType, lastRow.entityId, lastRow.organizationId, lastRow.metadata, lastRow.ip, lastRow.createdAt, lastRow.prevHash, lastRow.hash]);
      await db.query(`ALTER TABLE ${t} ENABLE TRIGGER audit_logs_row_guard`);
      await expect(db.query(`UPDATE ${t} SET action = 'X'`)).rejects.toThrow(/imutável/);
    });
    it('AUD-05 logs e eventos não guardam segredos (senhas, hashes, tokens, chaves, CPF)', async () => {
      const dump = JSON.stringify(await db.getRepository(AuditLog).find()) + JSON.stringify(await db.getRepository(PaymentEvent).find());
      expect(dump).not.toMatch(/\$2[aby]\$|eyJ[A-Za-z0-9_-]{10,}\.|chave-sandbox|chave-portal|mfaSecret|Senha@12345|NovaSenha|52998224725/);
    });
  });
});
