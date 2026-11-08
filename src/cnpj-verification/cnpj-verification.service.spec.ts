import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { CnpjVerificationService } from './cnpj-verification.service';

// Lógica com respostas simuladas; a consulta real é homologada por scripts/homologar-integracoes.js.
const CNPJ = '27977535000173';
const ong = { cnpj: CNPJ, razao_social: 'ASSOCIACAO X', nome_fantasia: '', situacao_cadastral: 'Ativa', natureza_juridica: 'Associação Privada', cnaes: [{ codigo: '9430800', descricao: 'Atividades de associações de defesa de direitos sociais' }] };
const r = (status: number, data: any = null) => ({ status, data }) as any;

describe('CnpjVerificationService', () => {
  const service = new CnpjVerificationService();
  const get = () => jest.spyOn(axios, 'get');

  beforeEach(() => { jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as any; }) as any); });
  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => expect(service).toBeDefined());

  it('CNPJ ativo e compatível → cnpjCompativel', async () => {
    get().mockResolvedValue(r(200, ong));
    expect((await service.consultarCnpj('27.977.535/0001-73', 'ASSOCIACAO X')).verificacao).toMatchObject({ situacaoAtiva: true, naturezaCompativel: true, cnpjCompativel: true });
  });
  it('não concede a verificação automática quando o nome informado não corresponde ao CNPJ', async () => {
    get().mockResolvedValue(r(200, ong));
    expect((await service.consultarCnpj(CNPJ, 'OUTRA ORGANIZACAO')).verificacao).toMatchObject({
      nomeCompativel: false,
      cnpjCompativel: false,
    });
  });
  it('não concede a verificação automática sem comparar o nome informado', async () => {
    get().mockResolvedValue(r(200, ong));
    expect((await service.consultarCnpj(CNPJ)).verificacao).toMatchObject({
      nomeCompativel: false,
      cnpjCompativel: false,
    });
  });
  it('404 → "não encontrado"; 400 → "inválido" (ambos BadRequest, sem retentativa)', async () => {
    const m = get().mockResolvedValue(r(404, { error: 'not found' }));
    await expect(service.consultarCnpj(CNPJ)).rejects.toThrow(/não encontrado/);
    m.mockResolvedValue(r(400, { error: 'invalid cnpj' }));
    await expect(service.consultarCnpj(CNPJ)).rejects.toBeInstanceOf(BadRequestException);
    expect(m).toHaveBeenCalledTimes(2);
  });
  it('5xx/rede: tenta de novo uma vez; persistindo → 503 (nunca aprova)', async () => {
    const m = get().mockResolvedValue(r(503, 'down'));
    await expect(service.consultarCnpj(CNPJ)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(m).toHaveBeenCalledTimes(2);
    m.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(service.consultarCnpj(CNPJ)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('falha transitória seguida de sucesso funciona', async () => {
    get().mockResolvedValueOnce(r(502, 'bad')).mockResolvedValueOnce(r(200, ong));
    expect((await service.consultarCnpj(CNPJ)).encontrado).toBe(true);
  });
  it('resposta de outro CNPJ ou em formato inesperado → 503, não aprova', async () => {
    get().mockResolvedValue(r(200, { ...ong, cnpj: '00000000000191' }));
    await expect(service.consultarCnpj(CNPJ)).rejects.toBeInstanceOf(ServiceUnavailableException);
    get().mockResolvedValue(r(200, '<html>'));
    await expect(service.consultarCnpj(CNPJ)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('CNPJ com tamanho errado é recusado sem chamar a fonte', async () => {
    const m = get();
    await expect(service.consultarCnpj('123')).rejects.toBeInstanceOf(BadRequestException);
    expect(m).not.toHaveBeenCalled();
  });
});
