import { migrateSchema, migratorConn, runtimeOptions } from './helpers/db';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { join } from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import { User, UserStatus, UserType } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { Medalha } from '../src/medalhas/entities/medalha.entity';
import {
  DocumentoMedalhaBranca,
  PedidoMedalhaBranca,
  StatusMedalhaBranca,
} from '../src/medalhas/entities/pedido-medalha-branca.entity';
import { MedalhasModule } from '../src/medalhas/medalhas.module';
import { AuditModule } from '../src/audit/audit.module';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Session } from '../src/auth/entities/session.entity';

// Banco real, mas tabelas/contas exclusivas de um schema temporário.
// Execute: node node_modules/jest/bin/jest.js --config test/jest-medalha-branca.json --runInBand
// O programa foi encerrado: o histórico (pedidos, análises e documentos) segue consultável e intacto; novos pedidos e análises não são aceitos.
describe('Medalha Branca — histórico do programa encerrado, no PostgreSQL', () => {
  jest.setTimeout(30000);
  const schema = `teste_medalha_${process.pid}_${Date.now()}`;
  let bootstrap: DataSource;
  let db: DataSource;
  let app: NestExpressApplication;
  let ong: User;
  let outra: User;
  let token: string;
  let outroToken: string;
  let adminToken: string;
  let doadorToken: string;
  let inativoToken: string;
  let pedidoRecusadoId: number;
  let pedidoAprovadoId: number;
  let documentoId: string;
  const avatares: string[] = [];
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
  );
  const enviar = (jwt = token) =>
    request(app.getHttpServer())
      .post('/medalha-branca/minha')
      .auth(jwt, { type: 'bearer' })
      .attach('documentos', pdf, {
        filename: 'estatuto.pdf',
        contentType: 'application/pdf',
      });

  beforeAll(async () => {
    await migrateSchema(schema);
    bootstrap = await migratorConn().initialize();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...runtimeOptions(schema),
          entities: [
            User,
            Medalha,
            PedidoMedalhaBranca,
            DocumentoMedalhaBranca,
            Session,
            AuditLog,
          ],
        }),
        MedalhasModule,
        UsersModule,
        AuditModule,
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
      prefix: '/uploads/',
    });
    await mkdir(join(process.cwd(), 'uploads', 'avatars'), { recursive: true });
    await app.init();
    db = app.get(DataSource);
    const repo = db.getRepository(User);
    const criar = (
      name: string,
      type = UserType.ONG,
      status = UserStatus.ATIVO,
    ) =>
      repo.save(
        repo.create({
          name,
          email: `${name}@example.invalid`,
          password: 'nao-utilizada',
          type,
          status,
          description: 'Descrição preservada',
          phone: '11999999999',
          city: 'São Paulo',
          profileImage: '/uploads/avatars/foto-anterior.png',
        }),
      );
    ong = await criar('ong');
    outra = await criar('outra');
    const jwt = app.get(JwtService);
    // Tokens só valem com sessão ativa no banco; admin precisa de sessão com MFA verificado.
    const assinar = async (user: User) => {
      const sessao = await db.getRepository(Session).save({
        userId: user.id,
        mfaVerified: true,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      return jwt.sign({
        sub: user.id,
        email: user.email,
        type: user.type,
        sid: sessao.id,
      });
    };
    token = await assinar(ong);
    outroToken = await assinar(outra);
    adminToken = await assinar(await criar('admin', UserType.ADMIN));
    doadorToken = await assinar(await criar('doador', UserType.DOADOR));
    inativoToken = await assinar(
      await criar('suspensa', UserType.ONG, UserStatus.SUSPENSO),
    );
    // Histórico antigo da ONG: um pedido recusado e, depois, um aprovado (com documento).
    const pedidos = db.getRepository(PedidoMedalhaBranca);
    const recusado = await pedidos.save(
      pedidos.create({
        ongId: ong.id,
        status: StatusMedalhaBranca.Recusado,
        motivo: 'Documento ilegível',
        analisadoEm: new Date('2026-01-10T12:00:00Z'),
        analisadoPor: 1,
      }),
    );
    const aprovado = await pedidos.save(
      pedidos.create({
        ongId: ong.id,
        status: StatusMedalhaBranca.Aprovado,
        analisadoEm: new Date('2026-02-10T12:00:00Z'),
        analisadoPor: 1,
      }),
    );
    pedidoRecusadoId = recusado.id;
    pedidoAprovadoId = aprovado.id;
    const doc = await db.getRepository(DocumentoMedalhaBranca).save(
      db.getRepository(DocumentoMedalhaBranca).create({
        solicitacaoId: aprovado.id,
        nome: 'estatuto.pdf',
        tipo: 'application/pdf',
        tamanho: pdf.length,
        conteudo: pdf,
      }),
    );
    documentoId = doc.id;
    await repo.update(ong.id, { medalhaBrancaLegada: true });
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const nome of avatares)
      await unlink(join(process.cwd(), 'uploads', 'avatars', nome));
    if (bootstrap?.isInitialized) {
      if (!/^teste_medalha_\d+_\d+$/.test(schema))
        throw new Error('Schema de teste inválido');
      await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);
      await bootstrap.destroy();
    }
  });

  it('mostra o histórico preservado: status atual e os pedidos, do mais recente ao mais antigo', async () => {
    const res = await request(app.getHttpServer())
      .get('/medalha-branca/minha')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(res.body.status).toBe('Aprovado');
    expect(res.body.solicitacoes.map((p: { id: number; status: string }) => [p.id, p.status])).toEqual([
      [pedidoAprovadoId, 'Aprovado'],
      [pedidoRecusadoId, 'Recusado'],
    ]);
    expect(res.body.solicitacoes[1].motivo).toBe('Documento ilegível');
    expect(res.body.solicitacoes[0].documentos[0]).not.toHaveProperty('conteudo');
  });

  it('ONG sem histórico segue como NaoSolicitado', async () => {
    const res = await request(app.getHttpServer())
      .get('/medalha-branca/minha')
      .auth(outroToken, { type: 'bearer' })
      .expect(200);
    expect(res.body).toEqual({ status: 'NaoSolicitado', solicitacoes: [] });
  });

  it('restringe a consulta a ONGs ativas e o histórico de uma ONG a administradores', async () => {
    await request(app.getHttpServer()).get('/medalha-branca/minha').expect(401);
    for (const jwt of [doadorToken, inativoToken]) {
      await request(app.getHttpServer())
        .get('/medalha-branca/minha')
        .auth(jwt, { type: 'bearer' })
        .expect(403);
    }
    await request(app.getHttpServer())
      .get(`/medalha-branca/admin/ongs/${ong.id}`)
      .auth(token, { type: 'bearer' })
      .expect(403);
    const admin = await request(app.getHttpServer())
      .get(`/medalha-branca/admin/ongs/${ong.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(admin.body.solicitacoes).toHaveLength(2);
  });

  it('o programa foi encerrado: novos pedidos e análises respondem 410 e nada é gravado', async () => {
    const antes = {
      pedidos: await db.getRepository(PedidoMedalhaBranca).count(),
      docs: await db.getRepository(DocumentoMedalhaBranca).count(),
    };
    const resp = await enviar().expect(410);
    expect(resp.body.message).toMatch(/encerrado/i);
    await request(app.getHttpServer())
      .patch(`/medalha-branca/admin/${pedidoAprovadoId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ status: 'Recusado', motivo: 'tentativa' })
      .expect(410);
    // A autorização continua valendo antes do encerramento.
    await request(app.getHttpServer()).post('/medalha-branca/minha').expect(401);
    await request(app.getHttpServer())
      .patch(`/medalha-branca/admin/${pedidoAprovadoId}`)
      .auth(token, { type: 'bearer' })
      .send({ status: 'Recusado' })
      .expect(403);
    expect(await db.getRepository(PedidoMedalhaBranca).count()).toBe(antes.pedidos);
    expect(await db.getRepository(DocumentoMedalhaBranca).count()).toBe(antes.docs);
    const aprovado = await db.getRepository(PedidoMedalhaBranca).findOneByOrFail({ id: pedidoAprovadoId });
    expect(aprovado.status).toBe('Aprovado');
    expect(
      (await db.getRepository(User).findOneByOrFail({ id: ong.id })).medalhaBrancaLegada,
    ).toBe(true);
  });

  it('não revela documentos ou solicitações de outra ONG', async () => {
    const minha = await request(app.getHttpServer())
      .get(`/medalha-branca/minha?ongId=${ong.id}`)
      .auth(outroToken, { type: 'bearer' })
      .expect(200);
    expect(minha.body).toEqual({ status: 'NaoSolicitado', solicitacoes: [] });
    await request(app.getHttpServer())
      .get(`/medalha-branca/documentos/${documentoId}`)
      .auth(outroToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/medalha-branca/documentos/${documentoId}`)
      .auth(doadorToken, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/medalha-branca/documentos/${documentoId}`)
      .expect(401);
    for (const jwt of [token, adminToken]) {
      const doc = await request(app.getHttpServer())
        .get(`/medalha-branca/documentos/${documentoId}`)
        .auth(jwt, { type: 'bearer' })
        .expect(200);
      expect(doc.body).toEqual(pdf);
      expect(doc.headers['cache-control']).toBe('private, no-store');
      expect(doc.headers['content-disposition']).toContain('attachment;');
    }
  });

  it('o perfil público não expõe nomes de medalhas por cor nem o histórico do programa', async () => {
    const publico = await request(app.getHttpServer())
      .get(`/users/ongs/${ong.id}`)
      .expect(200);
    expect(publico.body).toMatchObject({ name: 'ong', description: 'Descrição preservada' });
    for (const campo of ['medalhaVerde', 'medalhaBranca', 'medalhaBrancaLegada', 'preVerificacaoCnpj'])
      expect(publico.body).not.toHaveProperty(campo);
    const lista = await request(app.getHttpServer()).get('/users/ongs').expect(200);
    for (const item of lista.body as Record<string, unknown>[])
      for (const campo of ['medalhaVerde', 'medalhaBranca', 'medalhaBrancaLegada', 'preVerificacaoCnpj'])
        expect(item).not.toHaveProperty(campo);
  });

  it('continua permitindo editar o perfil e salvar/exibir a foto', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .auth(token, { type: 'bearer' })
      .send({ name: 'ONG editada' })
      .expect(200);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Pc8AAAAASUVORK5CYII=',
      'base64',
    );
    const foto = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .auth(token, { type: 'bearer' })
      .attach('file', png, {
        filename: 'teste-medalha.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(foto.body.profileImage).toMatch(
      /^\/uploads\/avatars\/[a-f0-9-]+\.png$/,
    );
    avatares.push(foto.body.profileImage.split('/').pop());
    const imagem = await request(app.getHttpServer())
      .get(foto.body.profileImage)
      .expect(200);
    expect(imagem.body).toEqual(png);
    const perfil = await request(app.getHttpServer())
      .get('/users/me')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(perfil.body).toMatchObject({
      name: 'ONG editada',
      profileImage: foto.body.profileImage,
      medalhaBrancaLegada: true,
    });
  });
});
