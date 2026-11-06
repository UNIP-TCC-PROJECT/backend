export const CATEGORIES = ['ATUALIZACAO', 'NOTICIA', 'ACAO_SOCIAL', 'EVENTO', 'RESULTADO_CAMPANHA', 'RELATORIO', 'ENTREGA'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  ATUALIZACAO: 'Atualização', NOTICIA: 'Notícia institucional', ACAO_SOCIAL: 'Ação social', EVENTO: 'Evento',
  RESULTADO_CAMPANHA: 'Resultado de campanha', RELATORIO: 'Relatório de atividades', ENTREGA: 'Registro de entrega',
};

/**
 * Classificação pública, calculada (a ONG não escolhe):
 *  INSTITUCIONAL         — conteúdo declarado pela ONG, sem anexos;
 *  DOCUMENTADA           — possui arquivos anexados (ainda não necessariamente analisados);
 *  EVIDENCIAS_ANALISADAS — ao menos um anexo aprovado pelo admin, ou vínculo com despesa aprovada / entrega com evidência aprovada.
 */
export type Classification = 'INSTITUCIONAL' | 'DOCUMENTADA' | 'EVIDENCIAS_ANALISADAS';

export const MAX_ANEXO_BYTES = 5 * 1024 * 1024;
export const MAX_ANEXOS_POR_PUBLICACAO = 10;
