import { BadRequestException } from '@nestjs/common';

export enum AccStatus {
  ENVIADA = 'ENVIADA',
  EM_ANALISE = 'EM_ANALISE',
  APROVADA = 'APROVADA',
  REPROVADA = 'REPROVADA',
  NECESSITA_COMPLEMENTACAO = 'NECESSITA_COMPLEMENTACAO',
}

export type ReviewAction = 'INICIAR' | 'APROVAR' | 'REPROVAR' | 'COMPLEMENTAR';

/**
 * Máquina de estados da análise. Nada nasce aprovado: tudo entra como ENVIADA e só um
 * administrador move para os demais estados. Estados finais (APROVADA/REPROVADA) não reabrem.
 */
export function nextStatus(current: string, action: ReviewAction): AccStatus {
  const open = current === AccStatus.ENVIADA || current === AccStatus.EM_ANALISE;
  if (action === 'INICIAR') {
    if (current !== AccStatus.ENVIADA) throw new BadRequestException('Só itens enviados podem entrar em análise.');
    return AccStatus.EM_ANALISE;
  }
  if (!open) throw new BadRequestException(`Item em "${current}" não pode ser analisado agora.`);
  return { APROVAR: AccStatus.APROVADA, REPROVAR: AccStatus.REPROVADA, COMPLEMENTAR: AccStatus.NECESSITA_COMPLEMENTACAO }[action];
}

export const needsReason = (a: ReviewAction) => a === 'REPROVAR' || a === 'COMPLEMENTAR';
