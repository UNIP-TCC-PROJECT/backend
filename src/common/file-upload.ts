import { BadRequestException, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { memoryStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  MAX_DOCUMENTO_BYTES,
  nomeDocumento,
  validarDocumentos,
} from '../medalhas/medalha-branca.upload';

export const singleFileUpload: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_DOCUMENTO_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) =>
    ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new BadRequestException('Envie PDF, JPG ou PNG.'), false),
};

/** Valida (tipo real pelos magic bytes, tamanho) e devolve os metadados persistíveis. */
export function prepareFile(file?: Express.Multer.File) {
  if (!file) throw new BadRequestException('Arquivo obrigatório.');
  validarDocumentos([file]);
  return {
    name: nomeDocumento(file.originalname),
    mime: file.mimetype,
    size: file.size,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
    content: file.buffer,
  };
}

export function fileResponse(
  res: { set(h: Record<string, string>): unknown },
  f: { name: string; mime: string; content: Buffer },
) {
  res.set({
    'Content-Type': f.mime,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(f.name)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(f.content);
}
