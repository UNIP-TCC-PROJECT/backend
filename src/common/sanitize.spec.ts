import { nextStatus } from './accountability-status';
import { redactPII } from './redact';
import { stripImageMetadata } from './sanitize';

const jpeg = (...segs: Buffer[]) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segs, Buffer.from([0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9])]);
const app = (marker: number, payload: string) => { const p = Buffer.from(payload); const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(p.length + 2, 2); return Buffer.concat([h, p]); };

describe('stripImageMetadata', () => {
  it('JPEG: remove EXIF/XMP/IPTC/comentário e preserva JFIF e os dados da imagem', () => {
    const out = stripImageMetadata(jpeg(app(0xe0, 'JFIF'), app(0xe1, 'Exif GPS -23.5,-46.6'), app(0xed, 'IPTC'), app(0xfe, 'comentario')), 'image/jpeg');
    expect(out.includes(Buffer.from('Exif'))).toBe(false);
    expect(out.includes(Buffer.from('IPTC'))).toBe(false);
    expect(out.includes(Buffer.from('comentario'))).toBe(false);
    expect(out.includes(Buffer.from('JFIF'))).toBe(true);
    expect(out.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });
  it('JPEG malformado volta intacto (não corrompe)', () => {
    const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]);
    expect(stripImageMetadata(bad, 'image/jpeg')).toEqual(bad);
  });
  it('PNG: remove eXIf/tEXt e preserva os demais chunks', () => {
    const chunk = (t: string, d: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length); h.write(t, 4, 'latin1'); return Buffer.concat([h, d, Buffer.alloc(4)]); };
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', Buffer.alloc(13)), chunk('eXIf', Buffer.from('GPSDATA')), chunk('tEXt', Buffer.from('Author=Maria')), chunk('IDAT', Buffer.from('pix')), chunk('IEND', Buffer.alloc(0))]);
    const out = stripImageMetadata(png, 'image/png');
    expect(out.includes(Buffer.from('GPSDATA'))).toBe(false);
    expect(out.includes(Buffer.from('Maria'))).toBe(false);
    expect(out.includes(Buffer.from('pix'))).toBe(true);
  });
  it('PDF passa sem alteração', () => {
    const pdf = Buffer.from('%PDF-1.4 x');
    expect(stripImageMetadata(pdf, 'application/pdf')).toBe(pdf);
  });
});

describe('redactPII', () => {
  it('mascara CPF, e-mail e telefone', () => {
    const t = redactPII('Entrega para 529.982.247-25, contato maria@ong.org ou (11) 99999-8888 e 11988887777');
    expect(t).not.toMatch(/529|maria@|99999|88887777/);
    expect(t).toContain('[CPF removido]');
  });
  it('mantém texto comum e valores', () => {
    expect(redactPII('Compra de 120 cestas por R$ 4.500,00')).toBe('Compra de 120 cestas por R$ 4.500,00');
  });
});

describe('máquina de estados da análise', () => {
  it('nada é aprovado direto; fluxo ENVIADA → EM_ANALISE → decisão', () => {
    expect(nextStatus('ENVIADA', 'INICIAR')).toBe('EM_ANALISE');
    expect(nextStatus('ENVIADA', 'APROVAR')).toBe('APROVADA');
    expect(nextStatus('EM_ANALISE', 'COMPLEMENTAR')).toBe('NECESSITA_COMPLEMENTACAO');
    expect(nextStatus('EM_ANALISE', 'REPROVAR')).toBe('REPROVADA');
  });
  it('estados finais ou aguardando ONG não são reanalisados', () => {
    for (const s of ['APROVADA', 'REPROVADA', 'NECESSITA_COMPLEMENTACAO']) {
      expect(() => nextStatus(s, 'APROVAR')).toThrow();
      expect(() => nextStatus(s, 'INICIAR')).toThrow();
    }
    expect(() => nextStatus('EM_ANALISE', 'INICIAR')).toThrow();
  });
});
