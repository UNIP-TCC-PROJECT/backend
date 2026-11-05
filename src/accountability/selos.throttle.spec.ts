import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { MAX_SELOS_IDS, parseOwnerIds, TransparencyController } from './accountability.controller';
import { TransparencyService } from './transparency.service';

describe('selos públicos: validação de ids', () => {
  it('aceita inteiros positivos, unifica repetidos', () => {
    expect(parseOwnerIds('1, 2,3')).toEqual([1, 2, 3]);
    expect(parseOwnerIds('7,7,7')).toEqual([7]);
    expect(parseOwnerIds(Array.from({ length: MAX_SELOS_IDS }, (_, i) => i + 1).join(','))).toHaveLength(MAX_SELOS_IDS);
  });
  it.each([undefined, null, '', '  ', 'abc', '0', '-1', '1.5', '1,,2', '1,a', '1e3', '0x10', '9999999999', ['1', '2'], { a: 1 }, '1;DROP TABLE x'])('rejeita %p', (ruim) => {
    expect(() => parseOwnerIds(ruim)).toThrow(BadRequestException);
  });
  it('rejeita mais de 50 ids distintos', () => {
    expect(() => parseOwnerIds(Array.from({ length: MAX_SELOS_IDS + 1 }, (_, i) => i + 1).join(','))).toThrow(/no máximo 50/);
  });
});

describe('selos públicos: limite de consultas (ThrottlerGuard real)', () => {
  let app: INestApplication;
  const selos = jest.fn(async (ids: number[]) => Object.fromEntries(ids.map((id) => [id, { cadastroVerificado: { verificado: false }, nivelTransparencia: null }])));
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
      controllers: [TransparencyController],
      providers: [{ provide: TransparencyService, useValue: { selos } }],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('responde até o limite e depois devolve 429, sem consultar o serviço', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 65; i++) codes.push((await request(app.getHttpServer()).get('/transparency/selos?ownerIds=1')).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes.slice(60).every((c) => c === 429)).toBe(true);
    expect(selos).toHaveBeenCalledTimes(60);
  });
});
