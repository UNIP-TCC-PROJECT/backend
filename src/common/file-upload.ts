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

/** Detecta o formato real pelos bytes (nunca pelo MIME/extensão informados pelo cliente). */
export function detectImage(b?: Buffer): { mime: string; ext: string } | null {
  if (!b || b.length < 12) return null;
  if (b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: 'png' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export function fileResponse(
  res: { set(h: Record<string, string>): unknown },
  f: { name: string; mime: string; content: Buffer },
  cacheControl = 'private, no-store',
) {
  res.set({
    'Content-Type': f.mime,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(f.name)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
  });
  return new StreamableFile(f.content);
}
