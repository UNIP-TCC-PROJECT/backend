import { BadRequestException } from '@nestjs/common';
import {
  MAX_DOCUMENTO_BYTES,
  nomeDocumento,
  validarDocumentos,
} from './medalha-branca.upload';

const arquivo = (mimetype: string, buffer: Buffer) =>
  ({ mimetype, buffer, originalname: 'documento' }) as Express.Multer.File;
describe('Documentos da Medalha Branca', () => {
  it.each([
    ['application/pdf', Buffer.from('%PDF-1.4\nconteudo')],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ['image/jpeg', Buffer.from([255, 216, 255, 224])],
  ])('aceita a assinatura de %s', (tipo, buffer) => {
    expect(() => validarDocumentos([arquivo(tipo, buffer)])).not.toThrow();
  });
  it.each([
    [],
    Array(6).fill(arquivo('application/pdf', Buffer.from('%PDF-1.4'))),
    [arquivo('application/pdf', Buffer.from('<script>'))],
    [arquivo('image/png', Buffer.from('%PDF-1.4'))],
    [arquivo('text/html', Buffer.from('%PDF-1.4'))],
    [arquivo('application/pdf', Buffer.alloc(0))],
    [arquivo('application/pdf', Buffer.alloc(MAX_DOCUMENTO_BYTES + 1))],
  ])('rejeita conteúdo, quantidade ou tamanho inválido %#', (...files) => {
    // it.each expande cada lista em argumentos.
    expect(() => validarDocumentos(files as Express.Multer.File[])).toThrow(
      BadRequestException,
    );
  });
  it('remove diretórios e caracteres de controle do nome', () => {
    expect(nomeDocumento('C:\\pasta\\estatuto\r\n.pdf')).toBe('estatuto.pdf');
    expect(nomeDocumento('../../documento.pdf')).toBe('documento.pdf');
  });
});
