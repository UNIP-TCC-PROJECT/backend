/** Última barreira antes de texto livre ir a público: mascara CPF, e-mail e telefone. */
export function redactPII(text?: string | null): string {
  return (text ?? '')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF removido]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail removido]')
    .replace(/(\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone removido]');
}
