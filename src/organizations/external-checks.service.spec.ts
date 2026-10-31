import axios from 'axios';
import { CheckSource, CheckStatus } from './entities/organization-external-check.entity';
import { ExternalChecksService } from './external-checks.service';

// Testes de lógica com respostas simuladas (formatos copiados de chamadas reais). NÃO homologam as fontes:
// a homologação real é feita por `node scripts/homologar-integracoes.js`.
const CNPJ = '27977535000173';
const org: any = { id: 'o1', cnpj: CNPJ, legalName: 'ASSOCIACAO DE PRODUTORES RURAIS DO CANTAO SUICO DAS MISSOES', tradeName: null, zip: '97980000', state: 'RS', city: 'SAO PAULO DAS MISSOES' };

const receita = { cnpj: CNPJ, razao_social: org.legalName, nome_fantasia: '', situacao_cadastral: 2, descricao_situacao_cadastral: 'ATIVA', natureza_juridica: 'Associação Privada', cnae_fiscal: 9499500, cnaes_secundarios: [{ codigo: 9430800 }], cep: '97980000', uf: 'RS', municipio: 'SAO PAULO DAS MISSOES' };
const mapaItem = { id_osc: 1251882, cd_identificador_osc: CNPJ, cd_situacao_cadastral: 2, tx_razao_social_osc: org.legalName, tx_nome_natureza_juridica_osc: 'Associação Privada', dt_fundacao_osc: '2017-05-10', tx_nome_municipio: 'São Paulo das Missões', tx_sigla_uf: 'RS', document: "'tsvector':1A" };
const r = (status: number, data: any = null) => ({ status, data, headers: {} }) as any;

describe('ExternalChecksService (lógica, fontes simuladas)', () => {
  const svc = new ExternalChecksService({ save: async (x: any) => x, create: (x: any) => x } as any);
  const run = async () => Object.fromEntries((await svc.runAll(org, null)).map((c: any) => [c.source, c]));
  let routes: Record<string, (url: string) => any>;

  beforeEach(() => {
    process.env.PORTAL_TRANSPARENCIA_API_KEY = 'chave-teste';
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as any; }) as any); // sem esperas reais
    routes = {
      brasilapi: () => r(200, receita),
      mapaosc: () => r(200, [mapaItem]),
      portaldatransparencia: () => r(200, []),
      transferegov: () => r(200, { data: [], total_items: 0 }),
    };
    jest.spyOn(axios, 'get').mockImplementation(async (url: string) => routes[Object.keys(routes).find((k) => url.includes(k))!](url));
  });
  afterEach(() => { jest.restoreAllMocks(); delete process.env.PORTAL_TRANSPARENCIA_API_KEY; delete process.env.MAPA_OSC_URL; });

  it('consulta o Mapa das OSCs na rota que existe (/api/api/busca/cnpj), não na removida', async () => {
    await run();
    const urls = (axios.get as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(urls).toContain(`https://mapaosc.ipea.gov.br/api/api/busca/cnpj/${CNPJ}`);
    expect(urls.some((u) => u.includes('mapaosc.ipea.gov.br/api/cnpj/'))).toBe(false);
  });

  it('URLs vêm do ambiente no momento do uso (o .env é carregado depois do import)', async () => {
    process.env.MAPA_OSC_URL = 'https://mapaosc.exemplo.test/osc';
    await run();
    expect((axios.get as jest.Mock).mock.calls.map((c) => c[0])).toContain(`https://mapaosc.exemplo.test/osc/${CNPJ}`);
  });

  describe('Mapa das OSCs', () => {
    it('só aceita o registro de CNPJ idêntico (a busca é por prefixo) e não vaza o tsvector', async () => {
      routes.mapaosc = () => r(200, [{ ...mapaItem, cd_identificador_osc: '27977558000188', id_osc: 2 }, mapaItem]);
      const c = (await run()).MAPA_OSC;
      expect(c.status).toBe(CheckStatus.OK);
      expect(c.data.resultados).toHaveLength(1);
      expect(c.data.resultados[0]).toMatchObject({ id_osc: 1251882, uf: 'RS' });
      expect(JSON.stringify(c.data)).not.toContain('tsvector');
    });
    it('só vizinhos de prefixo ou lista vazia → NAO_ENCONTRADO (neutro)', async () => {
      routes.mapaosc = () => r(200, [{ ...mapaItem, cd_identificador_osc: '27977558000188' }]);
      expect((await run()).MAPA_OSC.status).toBe(CheckStatus.NAO_ENCONTRADO);
      routes.mapaosc = () => r(200, []);
      expect((await run()).MAPA_OSC.status).toBe(CheckStatus.NAO_ENCONTRADO);
    });
    it('404 (rota removida) NÃO é "ausência neutra": é fonte indisponível', async () => {
      routes.mapaosc = () => r(404, '<html>');
      expect((await run()).MAPA_OSC).toMatchObject({ status: CheckStatus.INDISPONIVEL, httpStatus: 404 });
    });
    it('HTML/objeto no lugar da lista → indisponível', async () => {
      routes.mapaosc = () => r(200, '<html>');
      expect((await run()).MAPA_OSC.status).toBe(CheckStatus.INDISPONIVEL);
    });
  });

  describe('BrasilAPI', () => {
    it('dados conferem → OK, com a ressalva de que não equivale a confiança', async () => {
      const c = (await run()).BRASILAPI;
      expect(c.status).toBe(CheckStatus.OK);
      expect(c.summary).toMatch(/não equivale/i);
    });
    it('400 (CNPJ inválido) → ALERTA, não "indisponível"', async () => {
      routes.brasilapi = () => r(400, { message: 'inválido' });
      expect((await run()).BRASILAPI).toMatchObject({ status: CheckStatus.ALERTA, httpStatus: 400 });
    });
    it('404 → ALERTA; 5xx persistente → INDISPONIVEL (após 1 retentativa)', async () => {
      routes.brasilapi = () => r(404, {});
      expect((await run()).BRASILAPI.status).toBe(CheckStatus.ALERTA);
      routes.brasilapi = jest.fn(() => r(503, 'down'));
      expect((await run()).BRASILAPI).toMatchObject({ status: CheckStatus.INDISPONIVEL, httpStatus: 503 });
      expect(routes.brasilapi).toHaveBeenCalledTimes(2);
    });
    it('5xx transitório seguido de 200 → OK', async () => {
      let n = 0;
      routes.brasilapi = () => (n++ ? r(200, receita) : r(502, 'bad'));
      expect((await run()).BRASILAPI.status).toBe(CheckStatus.OK);
    });
    it('resposta de outro CNPJ → indisponível; razão social divergente → ALERTA', async () => {
      routes.brasilapi = () => r(200, { ...receita, cnpj: '00000000000191' });
      expect((await run()).BRASILAPI.status).toBe(CheckStatus.INDISPONIVEL);
      routes.brasilapi = () => r(200, { ...receita, razao_social: 'OUTRA LTDA' });
      expect((await run()).BRASILAPI.findings.join()).toMatch(/Razão social diverge/);
    });
    it('erro de rede nunca derruba nem aprova: vira INDISPONIVEL', async () => {
      routes.brasilapi = () => { throw new Error('ECONNRESET'); };
      expect((await run()).BRASILAPI.status).toBe(CheckStatus.INDISPONIVEL);
    });
  });

  describe('Portal da Transparência', () => {
    it('sem chave → INDISPONIVEL, sem chamar o Portal', async () => {
      delete process.env.PORTAL_TRANSPARENCIA_API_KEY;
      const c = (await run()).PORTAL_TRANSPARENCIA;
      expect(c.status).toBe(CheckStatus.INDISPONIVEL);
      expect((axios.get as jest.Mock).mock.calls.some((x) => String(x[0]).includes('portaldatransparencia'))).toBe(false);
    });
    it('envia a chave só no header e usa os parâmetros do swagger oficial', async () => {
      await run();
      const calls = (axios.get as jest.Mock).mock.calls.filter((x) => String(x[0]).includes('portaldatransparencia'));
      expect(calls.map((x) => [x[0].split('/').pop(), Object.keys(x[1].params)[0]])).toEqual([['ceis', 'codigoSancionado'], ['cnep', 'codigoSancionado'], ['cepim', 'cnpjSancionado']]);
      for (const x of calls) { expect(x[1].headers['chave-api-dados']).toBe('chave-teste'); expect(JSON.stringify(x[1].params)).not.toContain('chave-teste'); }
    });
    it('lista vazia → OK; registros → ALERTA; 401 → mensagem de chave inválida sem ecoar a chave; 429 → indisponível', async () => {
      expect((await run()).PORTAL_TRANSPARENCIA.status).toBe(CheckStatus.OK);
      routes.portaldatransparencia = (u) => r(200, u.endsWith('/ceis') ? [{ id: 1 }] : []);
      expect((await run()).PORTAL_TRANSPARENCIA.status).toBe(CheckStatus.ALERTA);
      routes.portaldatransparencia = () => r(401, { 'Erro na API': 'chave' });
      const c = (await run()).PORTAL_TRANSPARENCIA;
      expect(c).toMatchObject({ status: CheckStatus.INDISPONIVEL, httpStatus: 401 });
      expect(c.summary).not.toContain('chave-teste');
      routes.portaldatransparencia = () => r(429, {});
      expect((await run()).PORTAL_TRANSPARENCIA).toMatchObject({ status: CheckStatus.INDISPONIVEL, httpStatus: 429 });
    });
  });

  describe('Transferegov', () => {
    it('vazio → NAO_ENCONTRADO (neutro); com propostas → OK informativo; erro → INDISPONIVEL', async () => {
      expect((await run()).TRANSFEREGOV.status).toBe(CheckStatus.NAO_ENCONTRADO);
      routes.transferegov = () => r(200, { data: [{ id_proposta: 1, ds_objeto: 'x', situacao_proposta: 'y', nr_vlr_total: 10 }], total_items: 1 });
      expect((await run()).TRANSFEREGOV.status).toBe(CheckStatus.OK);
      routes.transferegov = () => r(422, { detail: [] });
      expect((await run()).TRANSFEREGOV).toMatchObject({ status: CheckStatus.INDISPONIVEL, httpStatus: 422 });
    });
  });

  it('registra uma linha por fonte, com fonte e data implícita (queriedAt é gerado pelo banco)', async () => {
    const all = await svc.runAll(org, 7);
    expect(all.map((c) => c.source).sort()).toEqual(Object.values(CheckSource).sort());
    expect(all.every((c: any) => c.organizationId === 'o1' && c.triggeredBy === 7)).toBe(true);
  });
});
