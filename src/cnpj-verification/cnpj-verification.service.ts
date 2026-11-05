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

  private normalizarCnpj(cnpj: string): string {
    return cnpj.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private calcularDigitoVerificador(base: string): number {
    const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
    let soma = 0;

    for (let i = base.length - 1, posicao = 0; i >= 0; i--, posicao++) {
      const valor = base.charCodeAt(i) - 48;
      soma += valor * pesos[posicao % pesos.length];
    }

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  private cnpjValido(cnpj: string): boolean {
    if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) {
      return false;
    }

    if (/^([A-Z0-9])\1{13}$/.test(cnpj)) {
      return false;
    }

    const primeiroDigito = this.calcularDigitoVerificador(cnpj.slice(0, 12));
    const segundoDigito = this.calcularDigitoVerificador(
      `${cnpj.slice(0, 12)}${primeiroDigito}`,
    );

    return cnpj.endsWith(`${primeiroDigito}${segundoDigito}`);
  }

  async consultarCnpj(cnpj: string, nomeInformado?: string) {
    const cnpjEntrada = cnpj.trim().toUpperCase();

    if (/[^A-Z0-9./\s-]/.test(cnpjEntrada)) {
      throw new BadRequestException('CNPJ inválido.');
    }

    const cnpjLimpo = this.normalizarCnpj(cnpjEntrada);

    if (!this.cnpjValido(cnpjLimpo)) {
      throw new BadRequestException('CNPJ inválido.');
    }

    if (!this.cnpjValido(cnpjLimpo)) {
      throw new BadRequestException('CNPJ inválido.');
    }

    let response;

    try {
      response = await axios.get(`https://api.opencnpj.org/${cnpjLimpo}`, {
        timeout: 10000,
      });
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new BadRequestException('CNPJ não encontrado.');
      }

      throw new ServiceUnavailableException(
        'Não foi possível consultar o CNPJ no momento. Tente novamente mais tarde.',
      );
    }

    const data = response.data;

    const cnpjEncontrado = true;

    const situacaoAtiva = data.situacao_cadastral === 'Ativa';

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

    const medalhaVerde =
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
        medalhaVerde,
      },
    };
  }
}
