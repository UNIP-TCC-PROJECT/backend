// Código COMPE/ISPB curto (3 dígitos) → nome. Lista das instituições mais usadas; "Outro" cobre o restante.
export const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil', '033': 'Santander', '104': 'Caixa Econômica Federal', '237': 'Bradesco', '341': 'Itaú Unibanco',
  '260': 'Nubank', '077': 'Banco Inter', '336': 'C6 Bank', '212': 'Banco Original', '290': 'PagBank (PagSeguro)', '323': 'Mercado Pago',
  '380': 'PicPay', '756': 'Sicoob', '748': 'Sicredi', '422': 'Banco Safra', '745': 'Citibank', '070': 'BRB – Banco de Brasília',
  '041': 'Banrisul', '004': 'Banco do Nordeste', '003': 'Banco da Amazônia', '136': 'Unicred', '133': 'Cresol', '197': 'Stone',
  '208': 'BTG Pactual', '623': 'Banco Pan', '655': 'Banco Votorantim (BV)', '218': 'Banco BS2', '121': 'Agibank', '348': 'Banco XP',
  '403': 'Cora', '332': 'Acesso Soluções de Pagamento', '329': 'QI Tech', '301': 'BPP Instituição de Pagamento',
};
export const BANK_CODES = Object.keys(BANKS);
