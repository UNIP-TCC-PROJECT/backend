import { BadRequestException } from '@nestjs/common';

export enum ContentReviewStatus {
  PENDENTE = 'PENDENTE',
  APROVADA = 'APROVADA',
  REPROVADA = 'REPROVADA',
}

export type ContentReviewDecision = 'APROVAR' | 'REPROVAR';

export function validateContentDecision(decision: ContentReviewDecision, reason?: string) {
  if (decision !== 'APROVAR' && decision !== 'REPROVAR') {
    throw new BadRequestException('Decisão inválida.');
  }
  if (decision === 'REPROVAR' && !reason?.trim()) {
    throw new BadRequestException('Informe o motivo da reprovação.');
  }
}
