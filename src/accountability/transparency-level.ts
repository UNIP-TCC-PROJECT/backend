/**
 * Níveis de transparência da ONG — regras em docs/NIVEIS-TRANSPARENCIA.md.
 *
 * Função pura: o nível é SEMPRE calculado a partir de registros reais (nunca armazenado nem editável
 * pela ONG), não usa pontuação/percentual e não considera quantidade de publicações. Dimensões sem dados
 * ainda (ex.: ONG sem doações) ficam "NAO_SE_APLICA" e não penalizam.
 */
export const RULES_VERSION = '1';
export const FRESH_DAYS = 90; // informações consideradas atualizadas
export const FUNDS_GRACE_DAYS = 60; // prazo para a 1ª despesa aprovada depois de arrecadar

export type DimensionKey = 'IDENTIDADE' | 'DOCUMENTACAO' | 'FINANCEIRA' | 'COMPROVACAO' | 'ENTREGAS' | 'ATUALIZACAO';
export type DimensionStatus = 'ATENDIDA' | 'PENDENTE' | 'NAO_SE_APLICA';
export type LevelCode = 'INICIAL' | 'DESENVOLVIMENTO' | 'AVANCADA' | 'EXEMPLAR';

export interface LevelInput {
  now: Date;
  /** Há consulta cadastral (Receita) registrada para a ONG. */
  hasReceitaCheck: boolean;
  requiredDocuments: { type: string; approved: boolean }[];
  /** Doações confirmadas: valor total e data da mais antiga ainda sem despesa aprovada na plataforma. */
  confirmedRaisedCents: number;
  firstConfirmedAt: Date | null;
  approvedExpenses: { id: string; hasApprovedDocument: boolean }[];
  deliveries: { id: string; hasApprovedEvidence: boolean }[];
  /** Último registro de atividade/análise da ONG na trilha de auditoria. */
  lastActivityAt: Date | null;
}

export interface Dimension {
  key: DimensionKey;
  label: string;
  question: string;
  status: DimensionStatus;
  met: string[];
  pending: string[];
}

export interface LevelResult {
  state: 'AVALIADA' | 'EM_ANDAMENTO';
  level: LevelCode | null;
  levelLabel: string;
  levelMeaning: string;
  dimensions: Dimension[];
  nextStep: string | null;
  evaluatedAt: string;
  basedOnActivityAt: string | null;
  rulesVersion: string;
}

export const LEVELS: Record<LevelCode, { label: string; meaning: string; requires: string }> = {
  INICIAL: { label: 'Transparência inicial', meaning: 'A instituição foi aprovada pela plataforma e começou a registrar informações.', requires: 'Instituição aprovada com a consulta cadastral registrada.' },
  DESENVOLVIMENTO: { label: 'Transparência em desenvolvimento', meaning: 'A identidade foi conferida em fonte pública e todos os documentos obrigatórios foram analisados e aprovados.', requires: 'Identidade e documentação atendidas.' },
  AVANCADA: { label: 'Transparência avançada', meaning: 'Além de identidade e documentos, o uso dos recursos recebidos está registrado e comprovado, nos pontos que já se aplicam à instituição.', requires: 'Nível anterior + financeira e comprovação de despesas atendidas (ou ainda não aplicáveis).' },
  EXEMPLAR: { label: 'Transparência exemplar', meaning: 'Todos os pontos aplicáveis estão atendidos, as informações estão atualizadas e há ao menos uma entrega com evidência analisada e aprovada.', requires: 'Nível anterior + entregas e atualização atendidas + ao menos uma entrega com evidência aprovada.' },
};

const DAY = 86_400_000;
const days = (a: Date, b: Date) => Math.floor((+a - +b) / DAY);

export function evaluateTransparency(i: LevelInput): LevelResult {
  const dims: Dimension[] = [];
  const add = (key: DimensionKey, label: string, question: string, status: DimensionStatus, met: string[], pending: string[]) => dims.push({ key, label, question, status, met, pending });

  // 1. Identidade
  add('IDENTIDADE', 'Identidade institucional', 'Os dados cadastrais foram conferidos em fonte pública e a instituição foi aprovada?',
    i.hasReceitaCheck ? 'ATENDIDA' : 'PENDENTE',
    ['Instituição aprovada pela plataforma', ...(i.hasReceitaCheck ? ['Cadastro consultado na Receita Federal'] : [])],
    i.hasReceitaCheck ? [] : ['Consulta cadastral na Receita Federal ainda não registrada']);

  // 2. Documentação
  const missingDocs = i.requiredDocuments.filter((d) => !d.approved);
  add('DOCUMENTACAO', 'Documentação', 'Os documentos obrigatórios foram analisados e aprovados?',
    missingDocs.length === 0 && i.requiredDocuments.length > 0 ? 'ATENDIDA' : 'PENDENTE',
    i.requiredDocuments.filter((d) => d.approved).map((d) => `${d.type} aprovado`), missingDocs.map((d) => `${d.type} sem aprovação`));

  // 3. Transparência financeira
  const raised = i.confirmedRaisedCents > 0;
  const oldFunds = raised && i.firstConfirmedAt && days(i.now, i.firstConfirmedAt) > FUNDS_GRACE_DAYS;
  const financeMet = !oldFunds || i.approvedExpenses.length > 0;
  add('FINANCEIRA', 'Transparência financeira', 'Os recursos recebidos têm uso registrado e aprovado?',
    !raised ? 'NAO_SE_APLICA' : financeMet ? 'ATENDIDA' : 'PENDENTE',
    raised && financeMet ? [i.approvedExpenses.length ? `${i.approvedExpenses.length} despesa(s) aprovada(s)` : `Doações recentes (menos de ${FUNDS_GRACE_DAYS} dias) ainda dentro do prazo`] : [],
    raised && !financeMet ? [`Há doações confirmadas há mais de ${FUNDS_GRACE_DAYS} dias sem nenhuma despesa aprovada`] : []);

  // 4. Comprovação das despesas
  const noProof = i.approvedExpenses.filter((e) => !e.hasApprovedDocument);
  add('COMPROVACAO', 'Comprovação das despesas', 'Cada despesa aprovada tem comprovante analisado?',
    i.approvedExpenses.length === 0 ? 'NAO_SE_APLICA' : noProof.length === 0 ? 'ATENDIDA' : 'PENDENTE',
    i.approvedExpenses.length - noProof.length > 0 ? [`${i.approvedExpenses.length - noProof.length} de ${i.approvedExpenses.length} despesa(s) com comprovante aprovado`] : [],
    noProof.length ? [`${noProof.length} despesa(s) aprovada(s) sem comprovante aprovado`] : []);

  // 5. Entregas e atividades
  const unverified = i.deliveries.filter((d) => !d.hasApprovedEvidence);
  const verifiedCount = i.deliveries.length - unverified.length;
  add('ENTREGAS', 'Entregas e atividades', 'As entregas registradas têm evidência analisada e aprovada?',
    i.deliveries.length === 0 ? 'NAO_SE_APLICA' : unverified.length === 0 ? 'ATENDIDA' : 'PENDENTE',
    verifiedCount ? [`${verifiedCount} de ${i.deliveries.length} entrega(s) com evidência aprovada`] : [],
    unverified.length ? [`${unverified.length} entrega(s) sem evidência aprovada`] : []);

  // 6. Atualização
  const age = i.lastActivityAt ? days(i.now, i.lastActivityAt) : null;
  add('ATUALIZACAO', 'Atualização das informações', `Houve registro ou análise nos últimos ${FRESH_DAYS} dias?`,
    age !== null && age <= FRESH_DAYS ? 'ATENDIDA' : 'PENDENTE',
    age !== null && age <= FRESH_DAYS ? [`Último registro há ${age} dia(s)`] : [],
    age !== null && age <= FRESH_DAYS ? [] : [age === null ? 'Nenhum registro encontrado' : `Último registro há ${age} dias`]);

  const by = Object.fromEntries(dims.map((d) => [d.key, d])) as Record<DimensionKey, Dimension>;
  const ok = (k: DimensionKey) => by[k].status !== 'PENDENTE'; // atendida ou ainda não aplicável
  const result = (level: LevelCode | null, next: string | null): LevelResult => ({
    state: level ? 'AVALIADA' : 'EM_ANDAMENTO',
    level,
    levelLabel: level ? LEVELS[level].label : 'Avaliação em andamento',
    levelMeaning: level ? LEVELS[level].meaning : 'Ainda não há dados suficientes para atribuir um nível. Isso não indica irregularidade.',
    dimensions: dims, nextStep: next, evaluatedAt: i.now.toISOString(), basedOnActivityAt: i.lastActivityAt?.toISOString() ?? null, rulesVersion: RULES_VERSION,
  });

  if (by.IDENTIDADE.status !== 'ATENDIDA') return result(null, 'Registrar a consulta cadastral da instituição.');
  if (by.DOCUMENTACAO.status !== 'ATENDIDA') return result('INICIAL', 'Ter todos os documentos obrigatórios analisados e aprovados.');
  if (!ok('FINANCEIRA') || !ok('COMPROVACAO')) return result('DESENVOLVIMENTO', 'Registrar e comprovar o uso dos recursos recebidos.');
  const exemplar = ok('ENTREGAS') && by.ATUALIZACAO.status === 'ATENDIDA' && verifiedCount >= 1;
  if (!exemplar) {
    const next = by.ATUALIZACAO.status !== 'ATENDIDA' ? 'Manter as informações atualizadas.' : verifiedCount < 1 ? 'Ter ao menos uma entrega com evidência aprovada.' : 'Ter evidência aprovada em todas as entregas registradas.';
    return result('AVANCADA', next);
  }
  return result('EXEMPLAR', null);
}
