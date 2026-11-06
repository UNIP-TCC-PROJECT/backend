import { isEmail } from 'class-validator';
import { cpfValido } from './cpf-validation';

function cnpjValido(valor: string): boolean {
  const cnpj = valor.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) {
    return false;
  }

  function calcularDigito(base: string): number {
    const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
    let soma = 0;

    for (let i = base.length - 1, posicao = 0; i >= 0; i--, posicao++) {
      const valorCaractere = base.charCodeAt(i) - 48;
      soma += valorCaractere * pesos[posicao % pesos.length];
    }

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  const primeiroDigito = calcularDigito(cnpj.slice(0, 12));
  const segundoDigito = calcularDigito(`${cnpj.slice(0, 12)}${primeiroDigito}`);

  return cnpj.endsWith(`${primeiroDigito}${segundoDigito}`);
}

export function pixKeyValida(chave: string): boolean {
  const valor = chave.trim();

  const cpfTemFormatoValido = /^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(
    valor,
  );

  if (cpfTemFormatoValido && cpfValido(valor)) {
    return true;
  }

  const cnpjTemFormatoValido =
    /^(?:[A-Z0-9]{12}\d{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2})$/i.test(
      valor,
    );

  if (cnpjTemFormatoValido && cnpjValido(valor)) {
    return true;
  }

  if (valor.length <= 77 && isEmail(valor)) {
    return true;
  }

  const telefoneComCodigo = /^\+55(?:[1-9]\d9\d{8}|[1-9]\d[2-5]\d{7})$/.test(
    valor,
  );
  const telefoneCelularNacional =
    /^(?:[1-9]\d9\d{8}|\([1-9]\d\)\s?9\d{4}-?\d{4})$/.test(valor);

  if (telefoneComCodigo || telefoneCelularNacional) {
    return true;
  }

  const chaveAleatoriaUuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      valor,
    );

  return chaveAleatoriaUuidV4;
}
