import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { onlyDigits, normalizeText } from './cnpj.util';
import { CheckSource, CheckStatus, OrganizationExternalCheck } from './entities/organization-external-check.entity';
import { Organization } from './entities/organization.entity';

type Result = Pick<OrganizationExternalCheck, 'status' | 'summary' | 'findings' | 'data' | 'httpStatus'>;

const TIMEOUT_MS = 8000;
const BRASILAPI = process.env.BRASILAPI_URL ?? 'https://brasilapi.com.br/api/cnpj/v1';
const MAPA_OSC = process.env.MAPA_OSC_URL ?? 'https://mapaosc.ipea.gov.br/api/cnpj';
const PORTAL = process.env.PORTAL_TRANSPARENCIA_URL ?? 'https://api.portaldatransparencia.gov.br/api-de-dados';
const TRANSFEREGOV = process.env.TRANSFEREGOV_URL ?? 'https://api-publica.transferegov.gestao.gov.br/parcerias';

// CNAEs (divisões) típicos do terceiro setor — apenas informativo para o analista.
const CNAE_TERCEIRO_SETOR = ['85', '86', '87', '88', '90', '91', '93', '94'];
const NATUREZA_OK = /associa[cç][aã]o|funda[cç][aã]o|organiza[cç][aã]o (religiosa|social)|entidade/i;

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
    const res = await axios.get(`${BRASILAPI}/${org.cnpj}`, { timeout: TIMEOUT_MS, validateStatus: () => true });
    if (res.status === 404) {
      return { status: CheckStatus.ALERTA, summary: 'CNPJ não encontrado na base da Receita (via BrasilAPI).', findings: ['CNPJ inexistente'], data: null, httpStatus: 404 };
    }
    if (res.status !== 200 || typeof res.data !== 'object') return unavailable(`BrasilAPI indisponível (HTTP ${res.status}).`, res.status);

    const d = res.data;
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
  private async mapaOsc(org: Organization): Promise<Result> {
    const res = await axios.get(`${MAPA_OSC}/${org.cnpj}`, { timeout: TIMEOUT_MS, validateStatus: () => true });
    if (res.status === 404) {
      return { status: CheckStatus.NAO_ENCONTRADO, summary: 'Sem registro no Mapa das OSCs. A ausência é neutra e não indica irregularidade.', findings: [], data: null, httpStatus: 404 };
    }
    if (res.status !== 200 || !Array.isArray(res.data)) return unavailable(`Mapa das OSCs indisponível ou em formato inesperado (HTTP ${res.status}).`, res.status);
    return res.data.length
      ? { status: CheckStatus.OK, summary: 'Organização localizada no Mapa das OSCs.', findings: [], data: { resultados: res.data.slice(0, 5) }, httpStatus: 200 }
      : { status: CheckStatus.NAO_ENCONTRADO, summary: 'Sem registro no Mapa das OSCs. A ausência é neutra e não indica irregularidade.', findings: [], data: null, httpStatus: 200 };
  }

  // ---------- Portal da Transparência: CEIS, CNEP e CEPIM (exige chave) ----------
  private async portalTransparencia(org: Organization): Promise<Result> {
    const key = process.env.PORTAL_TRANSPARENCIA_API_KEY;
    if (!key) return unavailable('Chave da API do Portal da Transparência não configurada (PORTAL_TRANSPARENCIA_API_KEY).');

    const query = (path: string, param: string) =>
      axios.get(`${PORTAL}/${path}`, { params: { [param]: org.cnpj, pagina: 1 }, headers: { 'chave-api-dados': key }, timeout: TIMEOUT_MS, validateStatus: () => true });
    const lists = { CEIS: await query('ceis', 'codigoSancionado'), CNEP: await query('cnep', 'codigoSancionado'), CEPIM: await query('cepim', 'cnpjSancionado') };

    const failed = Object.entries(lists).filter(([, r]) => r.status !== 200 || !Array.isArray(r.data));
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
    const get = (param: string) => axios.get(`${TRANSFEREGOV}/proposta`, { params: { [param]: org.cnpj, tamanho_da_pagina: 5, pagina: 1 }, timeout: TIMEOUT_MS, validateStatus: () => true });
    const [exec, rec] = await Promise.all([get('cnpj_executor'), get('cnpj_ente_recebedor')]);
    if ([exec, rec].some((r) => r.status !== 200 || !Array.isArray(r.data?.data))) {
      return unavailable(`Transferegov indisponível (HTTP ${exec.status}/${rec.status}).`, exec.status);
    }
    const total = (exec.data.total_items ?? exec.data.data.length) + (rec.data.total_items ?? rec.data.data.length);
    return total
      ? { status: CheckStatus.OK, summary: `${total} proposta(s) de parceria pública localizada(s) (informativo).`, findings: [], httpStatus: 200, data: { propostas: [...exec.data.data, ...rec.data.data].slice(0, 5).map((p: any) => ({ id_proposta: p.id_proposta, objeto: p.ds_objeto, situacao: p.situacao_proposta, valor_total: p.nr_vlr_total })) } }
      : { status: CheckStatus.NAO_ENCONTRADO, summary: 'Sem parcerias públicas no Transferegov. A ausência é neutra e não indica irregularidade.', findings: [], data: null, httpStatus: 200 };
  }
}
