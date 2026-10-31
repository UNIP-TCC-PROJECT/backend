import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosRequestConfig } from 'axios';
import { Repository } from 'typeorm';
import { onlyDigits, normalizeText } from './cnpj.util';
import { CheckSource, CheckStatus, OrganizationExternalCheck } from './entities/organization-external-check.entity';
import { Organization } from './entities/organization.entity';

type Result = Pick<OrganizationExternalCheck, 'status' | 'summary' | 'findings' | 'data' | 'httpStatus'>;

const TIMEOUT_MS = 8000;
// URLs lidas a cada uso: o ConfigModule só carrega o .env depois que este arquivo é importado.
const url = {
  brasilapi: () => process.env.BRASILAPI_URL ?? 'https://brasilapi.com.br/api/cnpj/v1',
  // O Mapa das OSCs é uma API Lumen publicada sob /api/api; a rota /api/cnpj/{cnpj} do Swagger não existe (404).
  mapaOsc: () => process.env.MAPA_OSC_URL ?? 'https://mapaosc.ipea.gov.br/api/api/busca/cnpj',
  portal: () => process.env.PORTAL_TRANSPARENCIA_URL ?? 'https://api.portaldatransparencia.gov.br/api-de-dados',
  transferegov: () => process.env.TRANSFEREGOV_URL ?? 'https://api-publica.transferegov.gestao.gov.br/parcerias',
};

// CNAEs (divisões) típicos do terceiro setor — apenas informativo para o analista.
const CNAE_TERCEIRO_SETOR = ['85', '86', '87', '88', '90', '91', '93', '94'];
const NATUREZA_OK = /associa[cç][aã]o|funda[cç][aã]o|organiza[cç][aã]o (religiosa|social)|entidade/i;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET com uma retentativa para falha de rede, 429 e 5xx. Nunca lança por status HTTP; erros de rede só na 2ª falha. */
async function get(target: string, config: AxiosRequestConfig = {}) {
  // User-Agent próprio: algumas fontes (ex.: BrasilAPI) bloqueiam agentes genéricos como "node".
  const opts = { timeout: TIMEOUT_MS, validateStatus: () => true, ...config, headers: { 'User-Agent': 'donatio-tcc/1.0', ...config.headers } };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await axios.get(target, opts);
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
        await wait(Math.min(Number(res.headers?.['retry-after']) * 1000 || 500, 3000));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt === 0) { await wait(500); continue; }
      throw e;
    }
  }
}

const unavailable = (summary: string, httpStatus: number | null = null): Result => ({
  status: CheckStatus.INDISPONIVEL, summary, findings: [], data: null, httpStatus,
});

/**
 * Consultas externas. REGRA: nenhuma falha aqui lança exceção nem aprova ninguém —
 * toda indisponibilidade vira um registro INDISPONIVEL e a ONG segue pendente de análise humana.
 */
@Injectable()
export class ExternalChecksService {
  private readonly logger = new Logger(ExternalChecksService.name);

  constructor(
    @InjectRepository(OrganizationExternalCheck) private repo: Repository<OrganizationExternalCheck>,
  ) {}

  async runAll(org: Organization, triggeredBy: number | null): Promise<OrganizationExternalCheck[]> {
    const runners: [CheckSource, () => Promise<Result>][] = [
      [CheckSource.BRASILAPI, () => this.brasilApi(org)],
      [CheckSource.MAPA_OSC, () => this.mapaOsc(org)],
      [CheckSource.PORTAL_TRANSPARENCIA, () => this.portalTransparencia(org)],
      [CheckSource.TRANSFEREGOV, () => this.transferegov(org)],
    ];
    const results = await Promise.all(
      runners.map(async ([source, run]) => {
        try {
          return { source, ...(await run()) };
        } catch (e) {
          this.logger.warn(`${source} falhou: ${(e as Error).message}`);
          return { source, ...unavailable('Falha ao consultar a fonte.') };
        }
      }),
    );
    return this.repo.save(results.map((r) => this.repo.create({ ...r, organizationId: org.id, triggeredBy })));
  }

  /** Última consulta de cada fonte. */
  async latest(organizationId: string): Promise<OrganizationExternalCheck[]> {
    const rows = await this.repo.find({ where: { organizationId }, order: { queriedAt: 'DESC' } });
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.source) ? false : (seen.add(r.source), true)));
  }

  history(organizationId: string) {
    return this.repo.find({ where: { organizationId }, order: { queriedAt: 'DESC' }, take: 100 });
  }

  // ---------- BrasilAPI: cadastro na Receita x dados informados ----------
  private async brasilApi(org: Organization): Promise<Result> {
    const res = await get(`${url.brasilapi()}/${org.cnpj}`);
    if (res.status === 400) {
      return { status: CheckStatus.ALERTA, summary: 'CNPJ recusado como inválido pela BrasilAPI (dígitos verificadores).', findings: ['CNPJ inválido'], data: null, httpStatus: 400 };
    }
    if (res.status === 404) {
      return { status: CheckStatus.ALERTA, summary: 'CNPJ não encontrado na base da Receita (via BrasilAPI).', findings: ['CNPJ inexistente'], data: null, httpStatus: 404 };
    }
    if (res.status !== 200 || typeof res.data !== 'object') return unavailable(`BrasilAPI indisponível (HTTP ${res.status}).`, res.status);

    const d = res.data;
    // A resposta precisa ser do CNPJ consultado; qualquer outra coisa é tratada como fonte indisponível/inconsistente.
    if (onlyDigits(d.cnpj) !== org.cnpj) return unavailable('BrasilAPI devolveu dados de outro CNPJ ou em formato inesperado.', res.status);
    const findings: string[] = [];
    const eq = (a?: string | null, b?: string | null) => normalizeText(a) === normalizeText(b);

    if (d.situacao_cadastral !== 2) findings.push(`Situação cadastral: ${d.descricao_situacao_cadastral ?? d.situacao_cadastral} (não ATIVA).`);
    if (!eq(d.razao_social, org.legalName)) findings.push(`Razão social diverge: informada "${org.legalName}" × Receita "${d.razao_social}".`);
    if (org.tradeName && d.nome_fantasia && !eq(d.nome_fantasia, org.tradeName)) findings.push(`Nome fantasia diverge: informado "${org.tradeName}" × Receita "${d.nome_fantasia}".`);
    const natureza = String(d.natureza_juridica ?? '');
    if (!NATUREZA_OK.test(natureza)) findings.push(`Natureza jurídica "${natureza}" não é típica de ONG.`);
    const cnaes = [d.cnae_fiscal, ...(d.cnaes_secundarios ?? []).map((c: any) => c.codigo)].filter(Boolean).map(String);
    if (!cnaes.some((c) => CNAE_TERCEIRO_SETOR.includes(c.slice(0, 2)))) findings.push('Nenhum CNAE típico de organizações do terceiro setor.');
    if (org.zip && onlyDigits(d.cep) !== org.zip) findings.push(`CEP diverge: informado ${org.zip} × Receita ${onlyDigits(d.cep)}.`);
    if (org.state && d.uf && org.state.toUpperCase() !== d.uf) findings.push(`UF diverge: informada ${org.state} × Receita ${d.uf}.`);
    if (org.city && d.municipio && !eq(org.city, d.municipio)) findings.push(`Município diverge: informado "${org.city}" × Receita "${d.municipio}".`);

    return {
      status: findings.length ? CheckStatus.ALERTA : CheckStatus.OK,
      summary: findings.length
        ? `${findings.length} ponto(s) de atenção. Cadastro ativo na Receita não equivale a instituição confiável.`
        : 'Dados conferem com a Receita. Isso não equivale a instituição confiável; análise documental é necessária.',
      findings,
      httpStatus: 200,
      data: {
        razao_social: d.razao_social, nome_fantasia: d.nome_fantasia, situacao_cadastral: d.descricao_situacao_cadastral ?? d.situacao_cadastral,
        natureza_juridica: natureza, cnae_fiscal: d.cnae_fiscal, cnae_fiscal_descricao: d.cnae_fiscal_descricao,
        cnaes_secundarios: (d.cnaes_secundarios ?? []).slice(0, 20), data_inicio_atividade: d.data_inicio_atividade,
        logradouro: d.logradouro, numero: d.numero, bairro: d.bairro, municipio: d.municipio, uf: d.uf, cep: d.cep,
      },
    };
  }

  // ---------- Mapa das OSCs (complementar) ----------
  // A rota é uma busca por prefixo de CNPJ: só vale o registro cujo CNPJ é exatamente o consultado.
  // 404 aqui significa rota alterada/removida (a rota existe e responde 200 com lista), nunca "OSC ausente".
  private async mapaOsc(org: Organization): Promise<Result> {
    const res = await get(`${url.mapaOsc()}/${org.cnpj}`);
    if (res.status !== 200 || !Array.isArray(res.data)) return unavailable(`Mapa das OSCs indisponível ou em formato inesperado (HTTP ${res.status}).`, res.status);
    const osc = res.data.find((o: any) => onlyDigits(o?.cd_identificador_osc) === org.cnpj);
    if (!osc) {
      return { status: CheckStatus.NAO_ENCONTRADO, summary: 'Sem registro no Mapa das OSCs. A ausência é neutra e não indica irregularidade.', findings: [], data: null, httpStatus: 200 };
    }
    return {
      status: CheckStatus.OK, summary: 'Organização localizada no Mapa das OSCs.', findings: [], httpStatus: 200,
      data: { resultados: [{ id_osc: osc.id_osc, razao_social: osc.tx_razao_social_osc, natureza_juridica: osc.tx_nome_natureza_juridica_osc, fundacao: osc.dt_fundacao_osc, municipio: osc.tx_nome_municipio, uf: osc.tx_sigla_uf, situacao_cadastral: osc.cd_situacao_cadastral }] },
    };
  }

  // ---------- Portal da Transparência: CEIS, CNEP e CEPIM (exige chave) ----------
  private async portalTransparencia(org: Organization): Promise<Result> {
    const key = process.env.PORTAL_TRANSPARENCIA_API_KEY;
    if (!key) return unavailable('Chave da API do Portal da Transparência não configurada (PORTAL_TRANSPARENCIA_API_KEY).');
    // 401/403 = chave inválida/revogada: mensagem própria, sem ecoar a chave.

    const query = (path: string, param: string) =>
      get(`${url.portal()}/${path}`, { params: { [param]: org.cnpj, pagina: 1 }, headers: { 'chave-api-dados': key } });
    const lists = { CEIS: await query('ceis', 'codigoSancionado'), CNEP: await query('cnep', 'codigoSancionado'), CEPIM: await query('cepim', 'cnpjSancionado') };

    const failed = Object.entries(lists).filter(([, r]) => r.status !== 200 || !Array.isArray(r.data));
    if (failed.some(([, r]) => r.status === 401 || r.status === 403)) return unavailable('Portal da Transparência recusou a chave de API (verifique PORTAL_TRANSPARENCIA_API_KEY).', failed[0][1].status);
    if (failed.length) return unavailable(`Portal da Transparência indisponível para ${failed.map(([n, r]) => `${n} (HTTP ${r.status})`).join(', ')}.`, failed[0][1].status);

    const findings = Object.entries(lists)
      .filter(([, r]) => r.data.length)
      .map(([name, r]) => `${name}: ${r.data.length} registro(s) — verificar vigência e detalhes no Portal.`);
    return {
      status: findings.length ? CheckStatus.ALERTA : CheckStatus.OK,
      summary: findings.length ? 'Há registros de sanções/impedimentos que exigem análise.' : 'Nenhum registro em CEIS, CNEP ou CEPIM.',
      findings,
      httpStatus: 200,
      data: Object.fromEntries(Object.entries(lists).map(([n, r]) => [n, r.data.slice(0, 5).map((x: any) => ({ id: x.id, dataInicioSancao: x.dataInicioSancao, dataFinalSancao: x.dataFinalSancao, motivo: x.motivo ?? x.tipoSancao?.descricaoResumida ?? null, orgao: x.orgaoSancionador?.nome ?? x.orgaoEntidade ?? null }))])),
    };
  }

  // ---------- Transferegov (parcerias públicas; informativo) ----------
  private async transferegov(org: Organization): Promise<Result> {
    const query = (param: string) => get(`${url.transferegov()}/proposta`, { params: { [param]: org.cnpj, tamanho_da_pagina: 5, pagina: 1 } });
    const [exec, rec] = await Promise.all([query('cnpj_executor'), query('cnpj_ente_recebedor')]);
    if ([exec, rec].some((r) => r.status !== 200 || !Array.isArray(r.data?.data))) {
      return unavailable(`Transferegov indisponível (HTTP ${exec.status}/${rec.status}).`, exec.status);
    }
    const total = (exec.data.total_items ?? exec.data.data.length) + (rec.data.total_items ?? rec.data.data.length);
    return total
      ? { status: CheckStatus.OK, summary: `${total} proposta(s) de parceria pública localizada(s) (informativo).`, findings: [], httpStatus: 200, data: { propostas: [...exec.data.data, ...rec.data.data].slice(0, 5).map((p: any) => ({ id_proposta: p.id_proposta, objeto: p.ds_objeto, situacao: p.situacao_proposta, valor_total: p.nr_vlr_total })) } }
      : { status: CheckStatus.NAO_ENCONTRADO, summary: 'Sem parcerias públicas no Transferegov. A ausência é neutra e não indica irregularidade.', findings: [], data: null, httpStatus: 200 };
  }
}
