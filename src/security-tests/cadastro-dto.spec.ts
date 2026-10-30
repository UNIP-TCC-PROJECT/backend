import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isValidWebsite, normalizeWebsite } from '../common/br-validators';
import { CreateUserDto } from '../users/dto/create-user-dto';

const ong = {
  name: 'ONG de Teste', email: 'ong@example.invalid', password: 'cavalo-bateria-2026', type: 'ONG', cnpj: '11222333000181', description: 'Descrição', category: 'saude',
  phone: '11999999999', zip: '01310100', street: 'Av. Paulista, 1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP', bank: 'Banco Teste',
  agency: '0001', account: '12345-6', accountType: 'Corrente', pixKey: 'ong@example.invalid', legalName: 'Maria de Teste', legalCpf: '529.982.247-25', website: 'www.minhaong.org.br',
};
const errs = async (over: object = {}) => (await validate(plainToInstance(CreateUserDto, { ...ong, ...over }))).map((e) => e.property);

describe('cadastro de ONG — validações do servidor', () => {
  it('aceita dados válidos', async () => expect(await errs()).toEqual([]));
  it.each(['111.111.111-11', '12345678900', '529.982.247-2', '529.982.247-250', '529.982.247-26'])('rejeita CPF %s', async (c) => expect(await errs({ legalCpf: c })).toContain('legalCpf'));
  it.each(['000', '00001', 'abcd', '12 3'])('rejeita agência %s', async (a) => expect(await errs({ agency: a })).toContain('agency'));
  it.each(['', '1234567890123-4', 'abc', '12345--6', '12345-66'])('rejeita conta "%s"', async (a) => expect(await errs({ account: a })).toContain('account'));
  it.each(['12345-6', '123456', '1234567890-X'])('aceita conta %s', async (a) => expect(await errs({ account: a })).not.toContain('account'));
  it.each(['Qualquer', 'corrente', '<script>', ''])('rejeita tipo de conta "%s"', async (t) => expect(await errs({ accountType: t })).toContain('accountType'));
  it.each(['Corrente', 'Poupança', 'Pagamento'])('aceita tipo de conta %s', async (t) => expect(await errs({ accountType: t })).not.toContain('accountType'));
  it('bairro é obrigatório para ONG', async () => expect(await errs({ district: '' })).toContain('district'));
  it('CPF do doador é opcional, mas se informado precisa ser válido', async () => {
    const d = { name: 'Doador Teste', email: 'd@example.invalid', password: 'cavalo-bateria-2026', type: 'DOADOR' };
    expect((await validate(plainToInstance(CreateUserDto, d))).length).toBe(0);
    expect((await validate(plainToInstance(CreateUserDto, { ...d, cpf: '111.111.111-11' }))).map((e) => e.property)).toContain('cpf');
    expect((await validate(plainToInstance(CreateUserDto, { ...d, cpf: '529.982.247-25' }))).length).toBe(0);
  });
});

describe('site', () => {
  it.each(['www.minhaong.org.br', 'minhaong.org', 'http://minhaong.org', 'https://minhaong.org/pagina?x=1', 'ong.com.br:8080'])('aceita %s (com ou sem https)', (u) => expect(isValidWebsite(u)).toBe(true));
  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'ftp://ong.org', 'semponto', 'http://', 'ong .org', 'https://ong.org/<script>'.replace('<script>', ' x')])('rejeita %s', (u) => expect(isValidWebsite(u)).toBe(false));
  it('normaliza: sem protocolo vira https://; vazio vira undefined', () => {
    expect(normalizeWebsite('www.minhaong.org')).toBe('https://www.minhaong.org');
    expect(normalizeWebsite('http://minhaong.org')).toBe('http://minhaong.org');
    expect(normalizeWebsite('  ')).toBeUndefined();
  });
});

describe('banco', () => {
  it('aceita código da lista e rejeita código fora dela', async () => {
    expect(await errs({ bankCode: '341' })).not.toContain('bankCode');
    for (const c of ['999', '34', 'abc', '0341', "' OR 1=1"]) expect(await errs({ bankCode: c })).toContain('bankCode');
  });
  it('sem código, aceita "Outro" em texto livre, mas limita o tamanho', async () => {
    expect(await errs({ bank: 'Banco Pequeno de Teste' })).not.toContain('bank');
    expect(await errs({ bank: 'x'.repeat(81) })).toContain('bank');
    expect(await errs({ bank: '' })).toContain('bank');
  });
  it('lista de bancos: códigos únicos de 3 dígitos', () => {
    const { BANK_CODES, BANKS } = require('../common/banks');
    expect(new Set(BANK_CODES).size).toBe(BANK_CODES.length);
    for (const c of BANK_CODES) { expect(c).toMatch(/^\d{3}$/); expect(BANKS[c].length).toBeGreaterThan(1); }
  });
});
