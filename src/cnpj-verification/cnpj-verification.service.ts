import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class CnpjVerificationService {

  private normalizarNome(nome: string): string {
    return nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private analisarCnae(cnaes: any[]) {
    let pontuacao = 0;
    const termosEncontrados: string[] = [];

    const regras = [
      { termo: 'ASSISTENCIA SOCIAL', pontos: 5 },
      { termo: 'DIREITOS SOCIAIS', pontos: 5 },
      { termo: 'DIREITOS HUMANOS', pontos: 5 },
      { termo: 'BENEFICENTE', pontos: 5 },
      { termo: 'FILANTROPICA', pontos: 5 },
      { termo: 'ORGANIZACAO DA SOCIEDADE CIVIL', pontos: 5 },
      { termo: 'MEIO AMBIENTE', pontos: 4 },
      { termo: 'PROTECAO SOCIAL', pontos: 4 },

      { termo: 'ASSOCIACAO', pontos: 2 },
      { termo: 'COMUNITARIA', pontos: 2 },
      { termo: 'COMUNIDADE', pontos: 2 },
      { termo: 'PROTECAO', pontos: 2 },
      { termo: 'DEFESA', pontos: 2 },
      { termo: 'SOCIAL', pontos: 1 },
    ];

    for (const cnae of cnaes) {
      const descricao = this.normalizarNome(cnae.descricao || '');

      for (const regra of regras) {
        if (descricao.includes(regra.termo)) {
          pontuacao += regra.pontos;
          termosEncontrados.push(regra.termo);
        }
      }
    }

    return {
      pontuacao,
      compativel: pontuacao >= 6,
      termosEncontrados,
    };
  }

async consultarCnpj(cnpj: string, nomeInformado?: string) {
  const cnpjLimpo = cnpj.replace(/\D/g, '');

  if (cnpjLimpo.length !== 14) {
    throw new BadRequestException(
      'CNPJ inválido. Informe um CNPJ com 14 dígitos.',
    );
  }

  const base = process.env.OPENCNPJ_URL ?? 'https://api.opencnpj.org';
  let response;

  // Uma retentativa para falha de rede/5xx/429; 400 e 404 são respostas definitivas da fonte.
  for (let tentativa = 0; ; tentativa++) {
    try {
      response = await axios.get(`${base}/${cnpjLimpo}`, { timeout: 10000, validateStatus: () => true });
    } catch {
      response = undefined;
    }
    const status = response?.status;
    if (status === 404) throw new BadRequestException('CNPJ não encontrado.');
    if (status === 400) throw new BadRequestException('CNPJ inválido.');
    if (status === 200) break;
    if (tentativa === 1) {
      throw new ServiceUnavailableException(
        'Não foi possível consultar o CNPJ no momento. Tente novamente mais tarde.',
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const data = response!.data;

  // Resposta fora do formato ou de outro CNPJ: a fonte é tratada como indisponível, nunca aprova.
  if (!data || typeof data !== 'object' || String(data.cnpj ?? '').replace(/\D/g, '') !== cnpjLimpo) {
    throw new ServiceUnavailableException(
      'Não foi possível consultar o CNPJ no momento. Tente novamente mais tarde.',
    );
  }

    const cnpjEncontrado = true;

    const situacaoAtiva =
      data.situacao_cadastral === 'Ativa';

    const naturezaCompativel = [
      'Associação Privada',
      'Fundação Privada',
      'Organização Religiosa',
    ].includes(data.natureza_juridica);

    const nomeOficial = data.razao_social || '';
    const nomeFantasia = data.nome_fantasia || '';

    let nomeCompativel = false;

    if (nomeInformado) {
      const nomeNormalizado = this.normalizarNome(nomeInformado);

      nomeCompativel =
        nomeNormalizado === this.normalizarNome(nomeOficial) ||
        nomeNormalizado === this.normalizarNome(nomeFantasia);
    }

    const analiseCnae = this.analisarCnae(data.cnaes || []);

    const cnpjCompativel =
      cnpjEncontrado &&
      situacaoAtiva &&
      naturezaCompativel &&
      analiseCnae.compativel;

    return {
      encontrado: true,
      cnpj: data.cnpj,
      razaoSocial: data.razao_social,
      nomeFantasia: data.nome_fantasia,
      situacaoCadastral: data.situacao_cadastral,
      naturezaJuridica: data.natureza_juridica,

      verificacao: {
        cnpjEncontrado,
        situacaoAtiva,
        naturezaCompativel,
        nomeCompativel,
        cnaeCompativel: analiseCnae.compativel,
        cnaePontuacao: analiseCnae.pontuacao,
        termosCnae: analiseCnae.termosEncontrados,
        cnpjCompativel,
      },
    };
  }
}
