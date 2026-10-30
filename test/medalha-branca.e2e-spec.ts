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
} from '../src/medalhas/entities/pedido-medalha-branca.entity';
import { MedalhasModule } from '../src/medalhas/medalhas.module';
import { AuditModule } from '../src/audit/audit.module';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Session } from '../src/auth/entities/session.entity';

// Banco real, mas tabelas/contas exclusivas de um schema temporário.
// Execute: node node_modules/jest/bin/jest.js --config test/jest-medalha-branca.json --runInBand
describe('Medalha Branca — fluxo isolado no PostgreSQL', () => {
  jest.setTimeout(30000);
  const schema = `teste_medalha_${process.pid}_${Date.now()}`;
  const options = {
    type: 'postgres' as const,
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'tcc_db',
  };
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
  let pedidoId: number;
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
    bootstrap = await new DataSource(options).initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...options,
          schema,
          synchronize: true,
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

  it('começa como NaoSolicitado', async () => {
    const res = await request(app.getHttpServer())
      .get('/medalha-branca/minha')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(res.body).toEqual({ status: 'NaoSolicitado', solicitacoes: [] });
  });

  it('restringe envio/consulta a ONGs ativas e análise a administradores', async () => {
    await request(app.getHttpServer()).get('/medalha-branca/minha').expect(401);
    for (const jwt of [doadorToken, inativoToken]) {
      await request(app.getHttpServer())
        .get('/medalha-branca/minha')
        .auth(jwt, { type: 'bearer' })
        .expect(403);
      await enviar(jwt).expect(403);
    }
    await request(app.getHttpServer())
      .get(`/medalha-branca/admin/ongs/${ong.id}`)
      .auth(token, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/medalha-branca/admin/1')
      .auth(token, { type: 'bearer' })
      .send({ status: 'Aprovado' })
      .expect(403);
  });

  it('recusa ausência de documento, formato falso e tamanho excessivo', async () => {
    await request(app.getHttpServer())
      .post('/medalha-branca/minha')
      .auth(token, { type: 'bearer' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/medalha-branca/minha')
      .auth(token, { type: 'bearer' })
      .attach('documentos', Buffer.from('<script>'), {
        filename: 'falso.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/medalha-branca/minha')
      .auth(token, { type: 'bearer' })
      .attach('documentos', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'grande.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);
    expect(await db.getRepository(PedidoMedalhaBranca).count()).toBe(0);
    expect(await db.getRepository(DocumentoMedalhaBranca).count()).toBe(0);
  });

  it('aceita só um de dois envios simultâneos e guarda os documentos', async () => {
    const respostas = await Promise.all([enviar(), enviar()]);
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    const sucesso = respostas.find((r) => r.status === 201)!;
    expect(sucesso.body.status).toBe('Pendente');
    pedidoId = sucesso.body.solicitacoes[0].id;
    documentoId = sucesso.body.solicitacoes[0].documentos[0].id;
    expect(sucesso.body.solicitacoes[0].documentos[0]).not.toHaveProperty(
      'conteudo',
    );
    expect(await db.getRepository(PedidoMedalhaBranca).count()).toBe(1);
    expect(await db.getRepository(DocumentoMedalhaBranca).count()).toBe(1);
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

  it('exige motivo na recusa e mantém o histórico ao reenviar', async () => {
    const analisar = () =>
      request(app.getHttpServer())
        .patch(`/medalha-branca/admin/${pedidoId}`)
        .auth(adminToken, { type: 'bearer' });
    await analisar().send({ status: 'Recusado', motivo: '  ' }).expect(400);
    await analisar().send({ status: 'Pendente' }).expect(400);
    const recusa = await analisar()
      .send({ status: 'Recusado', motivo: 'Documento ilegível' })
      .expect(200);
    expect(recusa.body.status).toBe('Recusado');
    expect(recusa.body.solicitacoes[0].motivo).toBe('Documento ilegível');
    await analisar().send({ status: 'Aprovado' }).expect(409);
    const nova = await enviar().expect(201);
    pedidoId = nova.body.solicitacoes[0].id;
    expect(nova.body.status).toBe('Pendente');
    expect(nova.body.solicitacoes.map((p) => p.status)).toEqual([
      'Pendente',
      'Recusado',
    ]);
  });

  it('aprova a medalha sem alterar foto e informações da ONG', async () => {
    const antes = await db.getRepository(User).findOneByOrFail({ id: ong.id });
    const res = await request(app.getHttpServer())
      .patch(`/medalha-branca/admin/${pedidoId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ status: 'Aprovado' })
      .expect(200);
    expect(res.body.status).toBe('Aprovado');
    expect(
      await db.getRepository(User).findOneByOrFail({ id: ong.id }),
    ).toEqual({ ...antes, medalhaBranca: true });
    await enviar().expect(409);
    const perfil = await request(app.getHttpServer())
      .get('/users/me')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(perfil.body).toMatchObject({
      name: 'ong',
      description: 'Descrição preservada',
      profileImage: antes.profileImage,
    });
    const publico = await request(app.getHttpServer())
      .get(`/users/ongs/${ong.id}`)
      .expect(200);
    expect(publico.body).toMatchObject({
      name: 'ong',
      description: 'Descrição preservada',
    });
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
      medalhaBranca: true,
    });
  });
});
