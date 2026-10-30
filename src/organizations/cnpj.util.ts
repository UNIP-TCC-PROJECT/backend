export const onlyDigits = (v?: string | null) => (v ?? '').replace(/\D/g, '');

/** Valida os dígitos verificadores (rejeita sequências repetidas). */
export function isValidCnpj(raw?: string | null): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += Number(c[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

export function isValidCpf(raw?: string | null): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export const normalizeText = (v?: string | null) =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
