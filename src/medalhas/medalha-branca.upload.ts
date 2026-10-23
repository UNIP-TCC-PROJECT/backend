import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const MAX_DOCUMENTOS = 5;
export const MAX_DOCUMENTO_BYTES = 5 * 1024 * 1024;
const tipos = ['application/pdf', 'image/jpeg', 'image/png'];

export const documentosUpload: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_DOCUMENTO_BYTES, files: MAX_DOCUMENTOS, fields: 0 },
  fileFilter: (_req, file, cb) => {
    if (!tipos.includes(file.mimetype)) {
      return cb(
        new BadRequestException('Envie documentos PDF, JPG ou PNG.'),
        false,
      );
    }
    cb(null, true);
  },
};

export function validarDocumentos(files: Express.Multer.File[]) {
  if (!files?.length || files.length > MAX_DOCUMENTOS) {
    throw new BadRequestException('Envie de 1 a 5 documentos.');
  }
  for (const file of files) {
    const buffer = file.buffer;
    const valido =
      buffer?.length > 0 &&
      buffer.length <= MAX_DOCUMENTO_BYTES &&
      ((file.mimetype === 'application/pdf' &&
        buffer.subarray(0, 5).toString() === '%PDF-') ||
        (file.mimetype === 'image/png' &&
          buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (file.mimetype === 'image/jpeg' &&
          buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))));
    if (!valido) {
      throw new BadRequestException(
        'Documento inválido. Use PDF, JPG ou PNG de até 5 MB.',
      );
    }
  }
}

export function nomeDocumento(nome: string) {
  return (
    nome
      .replace(/\\/g, '/')
      .split('/')
      .pop()!
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 180) || 'documento'
  );
}
