#!/usr/bin/env node
/**
 * Homologação REAL das integrações externas (chamadas de verdade, sem mocks).
 * Uso:  node scripts/homologar-integracoes.js [CNPJ_DE_TESTE]
 * Lê backend/.env (sem imprimir segredos). Sem credencial → "PENDENTE DE CREDENCIAL" (nunca "FUNCIONANDO").
 * Asaas: só roda no SANDBOX; recusa ASAAS_ENV=production. Cria e remove uma cobrança Pix de R$ 5,00.
 */
const fs = require('node:fs');
const path = require('node:path');

try {
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* sem .env: usa o ambiente */ }

const CNPJ = (process.argv[2] ?? '27977535000173').replace(/\D/g, ''); // OSC real presente no Mapa das OSCs (RS)
const E = process.env;
const mask = (k) => (k ? `${k.slice(0, 4)}…(${k.length} chars)` : '(vazia)');
const rows = [];
const add = (nome, situacao, detalhe) => { rows.push({ nome, situacao, detalhe }); console.log(`[${situacao}] ${nome} — ${detalhe}`); };

async function http(url, opts = {}) {
  const t0 = Date.now();
  // User-Agent explícito: a BrasilAPI devolve 403 para o UA padrão "node" do fetch.
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts, headers: { 'User-Agent': 'donatio-tcc-homologacao/1.0', ...opts.headers } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* não-JSON */ }
  return { status: res.status, json, text, ms: Date.now() - t0 };
}
const guard = (nome, fn) => fn().catch((e) => add(nome, 'NÃO FUNCIONANDO', `erro de rede/timeout: ${e.name}: ${e.message}`));

async function brasilapi() {
  const base = E.BRASILAPI_URL ?? 'https://brasilapi.com.br/api/cnpj/v1';
  const ok = await http(`${base}/${CNPJ}`);
  const bad = await http(`${base}/11111111111111`);
  const nf = await http(`${base}/99999999000191`);
  const shape = ok.json && ok.json.cnpj === CNPJ && typeof ok.json.razao_social === 'string' && typeof ok.json.situacao_cadastral === 'number' && typeof ok.json.natureza_juridica === 'string';
  const good = ok.status === 200 && shape && bad.status === 400 && nf.status === 404;
  add('BrasilAPI', good ? 'FUNCIONANDO' : 'PARCIALMENTE FUNCIONANDO',
    `existente=${ok.status} (${ok.ms}ms, formato ${shape ? 'ok' : 'DIVERGENTE'}), dígito inválido=${bad.status}, inexistente=${nf.status}`);
}

async function opencnpj() {
  const base = E.OPENCNPJ_URL ?? 'https://api.opencnpj.org';
  const ok = await http(`${base}/${CNPJ}`);
  const nf = await http(`${base}/99999999000191`);
  const bad = await http(`${base}/123`);
  const shape = ok.json && ok.json.cnpj === CNPJ && typeof ok.json.situacao_cadastral === 'string' && typeof ok.json.natureza_juridica === 'string' && Array.isArray(ok.json.cnaes);
  const good = ok.status === 200 && shape && nf.status === 404 && bad.status === 400;
  add('OpenCNPJ', good ? 'FUNCIONANDO' : 'PARCIALMENTE FUNCIONANDO',
    `existente=${ok.status} (${ok.ms}ms, formato ${shape ? 'ok' : 'DIVERGENTE'}), inexistente=${nf.status}, curto=${bad.status}`);
}

async function mapaOsc() {
  const base = E.MAPA_OSC_URL ?? 'https://mapaosc.ipea.gov.br/api/api/busca/cnpj';
  const ok = await http(`${base}/${CNPJ}`);
  const found = Array.isArray(ok.json) && ok.json.some((o) => o.cd_identificador_osc === CNPJ);
  const nf = await http(`${base}/99999999000191`);
  const old = await http(`https://mapaosc.ipea.gov.br/api/cnpj/${CNPJ}`);
  const good = ok.status === 200 && found && nf.status === 200 && Array.isArray(nf.json) && nf.json.length === 0;
  add('Mapa das OSCs', good ? 'FUNCIONANDO' : ok.status === 200 ? 'PARCIALMENTE FUNCIONANDO' : 'NÃO FUNCIONANDO',
    `rota nova=${ok.status} (${ok.ms}ms, OSC ${found ? 'localizada' : 'NÃO localizada'}), inexistente=${nf.status}/lista ${nf.json?.length ?? '?'}; rota antiga /api/cnpj=${old.status}`);
}

async function transferegov() {
  const base = E.TRANSFEREGOV_URL ?? 'https://api-publica.transferegov.gestao.gov.br/parcerias';
  const q = (p, v) => http(`${base}/proposta?${p}=${v}&pagina=1&tamanho_da_pagina=2`);
  const upd = await http(`${base}/data-atualizacao`);
  const first = await http(`${base}/proposta?pagina=1&tamanho_da_pagina=1`);
  const known = first.json?.data?.[0]?.cnpj_ente_recebedor; // um CNPJ que consta de fato na base
  const hit = known && (await q('cnpj_ente_recebedor', known));
  const none = await q('cnpj_executor', '99999999999999');
  const mine = await q('cnpj_executor', CNPJ);
  const shape = Array.isArray(hit?.json?.data) && typeof hit?.json?.total_items === 'number';
  const filters = hit?.json?.total_items > 0 && none.json?.total_items === 0;
  add('Transferegov', upd.status === 200 && shape && filters ? 'FUNCIONANDO' : 'PARCIALMENTE FUNCIONANDO',
    `sem autenticação; base atualizada em ${upd.json?.data_ultima_atualizacao ?? '?'}; filtro positivo=${hit?.json?.total_items} item(ns), negativo=${none.json?.total_items}; consulta ${CNPJ}=${mine.status}/${mine.json?.total_items ?? '?'} item(ns)`);
}

async function portal() {
  const base = E.PORTAL_TRANSPARENCIA_URL ?? 'https://api.portaldatransparencia.gov.br/api-de-dados';
  const key = E.PORTAL_TRANSPARENCIA_API_KEY;
  const sem = await http(`${base}/ceis?codigoSancionado=${CNPJ}&pagina=1`);
  const swagger = await http('https://api.portaldatransparencia.gov.br/v3/api-docs');
  const paths = swagger.json?.paths ?? {};
  const docOk = ['ceis', 'cnep', 'cepim'].every((e) => paths[`/api-de-dados/${e}`]);
  if (!key) {
    return add('Portal da Transparência', 'PENDENTE DE CREDENCIAL',
      `PORTAL_TRANSPARENCIA_API_KEY ausente. Sem chave a API responde ${sem.status} (esperado 401); endpoints ceis/cnep/cepim ${docOk ? 'constam' : 'NÃO constam'} no swagger oficial. Consulta autenticada NÃO testada.`);
  }
  const call = (e, p) => http(`${base}/${e}?${p}=${CNPJ}&pagina=1`, { headers: { 'chave-api-dados': key } });
  const [a, b, c] = await Promise.all([call('ceis', 'codigoSancionado'), call('cnep', 'codigoSancionado'), call('cepim', 'cnpjSancionado')]);
  const all = [a, b, c];
  const good = all.every((r) => r.status === 200 && Array.isArray(r.json));
  add('Portal da Transparência', good ? 'FUNCIONANDO' : all.some((r) => r.status === 401 || r.status === 403) ? 'NÃO FUNCIONANDO' : 'PARCIALMENTE FUNCIONANDO',
    `chave ${mask(key)}; ceis=${a.status}/${a.json?.length ?? '?'}, cnep=${b.status}/${b.json?.length ?? '?'}, cepim=${c.status}/${c.json?.length ?? '?'}`);
}

async function asaas() {
  const key = E.ASAAS_API_KEY;
  const env = E.ASAAS_ENV ?? 'sandbox';
  const semChave = await http('https://api-sandbox.asaas.com/v3/customers?limit=1');
  const tokenOk = (E.ASAAS_WEBHOOK_TOKEN ?? '').length >= 32;
  if (env === 'production') return add('Asaas', 'NÃO EXECUTADO', 'ASAAS_ENV=production: este script só roda no sandbox.');
  if (!key) {
    return add('Asaas', 'PENDENTE DE CREDENCIAL',
      `ASAAS_API_KEY ausente (sandbox sem chave responde ${semChave.status}, esperado 401); ASAAS_WEBHOOK_TOKEN ${tokenOk ? 'definido' : 'ausente/curto (<32)'}. Cobrança/Pix/webhook NÃO testados.`);
  }
  const base = 'https://api-sandbox.asaas.com/v3';
  const h = { access_token: key, 'Content-Type': 'application/json', 'User-Agent': 'donatio-tcc-homologacao' };
  const log = [];
  const step = async (nome, fn) => { const r = await fn(); log.push(`${nome}=${r.status}`); return r; };
  const me = await step('auth', () => http(`${base}/myAccount/commercialInfo`, { headers: h }));
  if (me.status !== 200) return add('Asaas', 'NÃO FUNCIONANDO', `autenticação recusada (${me.status}); chave ${mask(key)} — confira se é chave do SANDBOX.`);
  const cus = await step('cliente', () => http(`${base}/customers`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Homologacao Donatio', cpfCnpj: '24971563792', notificationDisabled: true, externalReference: `homolog-${Date.now()}` }) }));
  const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const pay = cus.json?.id && await step('cobranca_pix', () => http(`${base}/payments`, { method: 'POST', headers: h, body: JSON.stringify({ customer: cus.json.id, billingType: 'PIX', value: 5, dueDate: due, description: 'Homologacao', externalReference: `homolog-${Date.now()}` }) }));
  const id = pay?.json?.id;
  const qr = id && await step('qrcode', () => http(`${base}/payments/${id}/pixQrCode`, { headers: h }));
  const st = id && await step('consulta', () => http(`${base}/payments/${id}`, { headers: h }));
  const del = id && await step('cancelamento', () => http(`${base}/payments/${id}`, { method: 'DELETE', headers: h }));
  const good = cus.status === 200 && pay?.status === 200 && qr?.status === 200 && typeof qr.json?.payload === 'string' && st?.json?.status === 'PENDING' && del?.json?.deleted === true;
  const dica = qr && qr.status !== 200 ? ' | QR Code falhou: cadastre uma chave Pix (EVP) no painel do sandbox.' : '';
  add('Asaas', good ? 'FUNCIONANDO (cobrança → Pix → consulta → cancelamento; webhook e pagamento NÃO cobertos)' : 'PARCIALMENTE FUNCIONANDO', `chave ${mask(key)}; ${log.join(', ')}${dica}`);
}

(async () => {
  console.log(`CNPJ de teste: ${CNPJ}\n`);
  for (const [n, f] of [['BrasilAPI', brasilapi], ['OpenCNPJ', opencnpj], ['Mapa das OSCs', mapaOsc], ['Transferegov', transferegov], ['Portal da Transparência', portal], ['Asaas', asaas]]) await guard(n, f);
  process.exitCode = rows.some((r) => r.situacao.startsWith('NÃO FUNCIONANDO')) ? 1 : 0;
})();
