import { OrganizationStatus } from './entities/organization.entity';
import { evaluateRegistration, RegistrationInput } from './registration-verification';

const docs = (ok = true) => ['ESTATUTO', 'ATA_DIRETORIA', 'COMPROVANTE_ENDERECO', 'DOC_REPRESENTANTE'].map((type) => ({ type, approved: ok }));
const base = (o: Partial<RegistrationInput> = {}): RegistrationInput => ({
  status: OrganizationStatus.APROVADA, hasCadastralCheck: true, requiredDocuments: docs(),
  approvedAt: new Date('2026-09-01T12:00:00Z'), checkedAt: new Date('2026-10-30T12:00:00Z'), approvedWithReservations: false, ...o,
});

describe('cadastro verificado', () => {
  it('aprovada + consulta + documentos aprovados → verificado, com datas e critérios', () => {
    const r = evaluateRegistration(base());
    expect(r).toMatchObject({ verified: true, validatedAt: '2026-09-01T12:00:00.000Z', checkedAt: '2026-10-30T12:00:00.000Z', withReservations: false });
    expect(r.criteria).toHaveLength(3);
  });
  it.each([
    OrganizationStatus.SUSPENSA, OrganizationStatus.EM_ANALISE, OrganizationStatus.REPROVADA,
    OrganizationStatus.INCOMPLETO, OrganizationStatus.AGUARDANDO_DOCUMENTACAO,
  ])('status %s não é verificado (muda sozinho se a ONG for suspensa)', (status) => {
    expect(evaluateRegistration(base({ status })).verified).toBe(false);
  });
  it('sem organização (cadastro antigo) não é verificado', () => {
    expect(evaluateRegistration(base({ status: null })).verified).toBe(false);
  });
  it('documento obrigatório fora de aprovação derruba o selo; lista vazia não vale como "tudo aprovado"', () => {
    expect(evaluateRegistration(base({ requiredDocuments: [...docs().slice(1), { type: 'ESTATUTO', approved: false }] })).verified).toBe(false);
    expect(evaluateRegistration(base({ requiredDocuments: [] })).verified).toBe(false);
  });
  it('sem consulta cadastral não é verificado', () => {
    expect(evaluateRegistration(base({ hasCadastralCheck: false })).verified).toBe(false);
  });
  it('aprovação com ressalvas só aparece como indicador, nunca com o motivo', () => {
    const r = evaluateRegistration(base({ approvedWithReservations: true }));
    expect(r.withReservations).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/justific|motivo|reason|admin/i);
    expect(evaluateRegistration(base({ approvedWithReservations: true, status: OrganizationStatus.SUSPENSA })).withReservations).toBe(false);
  });
  it('quando não verificado, não expõe critérios nem datas', () => {
    expect(evaluateRegistration(base({ status: OrganizationStatus.SUSPENSA }))).toMatchObject({ verified: false, validatedAt: null, checkedAt: null, criteria: [] });
  });
});
