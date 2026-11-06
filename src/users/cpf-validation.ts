export function cpfValido(cpf: string): boolean {
  const numeros = cpf.replace(/\D/g, '');

  if (!/^\d{11}$/.test(numeros) || /^(\d)\1{10}$/.test(numeros)) {
    return false;
  }

  function calcularDigito(base: string, pesoInicial: number): number {
    let soma = 0;

    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (pesoInicial - i);
    }

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  const base = numeros.slice(0, 9);
  const primeiroDigito = calcularDigito(base, 10);
  const segundoDigito = calcularDigito(`${base}${primeiroDigito}`, 11);

  return numeros === `${base}${primeiroDigito}${segundoDigito}`;
}
