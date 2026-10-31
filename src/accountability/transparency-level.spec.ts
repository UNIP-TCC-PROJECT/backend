import { evaluateTransparency, LevelInput } from './transparency-level';

const now = new Date('2026-10-30T12:00:00Z');
const ago = (d: number) => new Date(+now - d * 86_400_000);
const docs = (ok = true) => ['ESTATUTO', 'ATA_DIRETORIA', 'COMPROVANTE_ENDERECO', 'DOC_REPRESENTANTE'].map((type) => ({ type, approved: ok }));
const base = (o: Partial<LevelInput> = {}): LevelInput => ({
  now, hasReceitaCheck: true, requiredDocuments: docs(), confirmedRaisedCents: 0, firstConfirmedAt: null,
  approvedExpenses: [], deliveries: [], lastActivityAt: ago(5), ...o,
});
const level = (o?: Partial<LevelInput>) => evaluateTransparency(base(o));

describe('níveis de transparência', () => {
  it('sem consulta cadastral → "Avaliação em andamento" (sem nível inventado)', () => {
    const r = level({ hasReceitaCheck: false });
    expect(r).toMatchObject({ state: 'EM_ANDAMENTO', level: null, levelLabel: 'Avaliação em andamento' });
  });
  it('documentos pendentes → Inicial', () => {
    expect(level({ requiredDocuments: [...docs().slice(1), { type: 'ESTATUTO', approved: false }] }).level).toBe('INICIAL');
    expect(level({ requiredDocuments: [] }).level).toBe('INICIAL'); // sem lista não é "tudo aprovado"
  });
  it('ONG pequena e nova (sem campanhas) com identidade e documentos → Avançada, sem penalidade por ter pouco', () => {
    const r = level();
    expect(r.level).toBe('AVANCADA');
    expect(r.dimensions.filter((d) => d.status === 'NAO_SE_APLICA').map((d) => d.key)).toEqual(['FINANCEIRA', 'COMPROVACAO', 'ENTREGAS']);
  });
  it('doações antigas sem nenhuma despesa aprovada → Em desenvolvimento', () => {
    const r = level({ confirmedRaisedCents: 10000, firstConfirmedAt: ago(61) });
    expect(r.level).toBe('DESENVOLVIMENTO');
    expect(r.dimensions.find((d) => d.key === 'FINANCEIRA')!.pending[0]).toMatch(/60 dias/);
  });
  it('doações recentes ainda estão dentro do prazo', () => {
    expect(level({ confirmedRaisedCents: 10000, firstConfirmedAt: ago(10) }).level).toBe('AVANCADA');
  });
  it('despesa aprovada sem comprovante aprovado → Em desenvolvimento', () => {
    const r = level({ confirmedRaisedCents: 10000, firstConfirmedAt: ago(70), approvedExpenses: [{ id: 'e1', hasApprovedDocument: false }] });
    expect(r.level).toBe('DESENVOLVIMENTO');
    expect(r.dimensions.find((d) => d.key === 'COMPROVACAO')!.status).toBe('PENDENTE');
  });
  it('Exemplar exige ao menos uma entrega com evidência aprovada', () => {
    const fin = { confirmedRaisedCents: 10000, firstConfirmedAt: ago(70), approvedExpenses: [{ id: 'e1', hasApprovedDocument: true }] };
    expect(level(fin).level).toBe('AVANCADA');
    expect(level({ ...fin, deliveries: [{ id: 'd1', hasApprovedEvidence: true }] }).level).toBe('EXEMPLAR');
    const parcial = level({ ...fin, deliveries: [{ id: 'd1', hasApprovedEvidence: true }, { id: 'd2', hasApprovedEvidence: false }] });
    expect(parcial.level).toBe('AVANCADA');
    expect(parcial.nextStep).toMatch(/todas as entregas/);
  });
  it('informações desatualizadas (> 90 dias) impedem o nível Exemplar', () => {
    const r = level({ lastActivityAt: ago(120), deliveries: [{ id: 'd1', hasApprovedEvidence: true }] });
    expect(r.level).toBe('AVANCADA');
    expect(r.dimensions.find((d) => d.key === 'ATUALIZACAO')!.status).toBe('PENDENTE');
  });
  it('é determinística, informa data da avaliação e versão das regras, sem pontuação', () => {
    const r = level();
    expect(r.evaluatedAt).toBe(now.toISOString());
    expect(r.rulesVersion).toBe('1');
    expect(JSON.stringify(r)).not.toMatch(/score|pontua|percent/i);
    expect(level()).toEqual(r);
  });
});
