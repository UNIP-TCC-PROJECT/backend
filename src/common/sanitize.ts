/** Remove metadados (EXIF/GPS, XMP, IPTC, comentários) de JPEG/PNG antes de guardar. Outros formatos passam intactos. */
export function stripImageMetadata(buf: Buffer, mime: string): Buffer {
  if (mime === 'image/jpeg') return stripJpeg(buf);
  if (mime === 'image/png') return stripPng(buf);
  return buf;
}

// APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) e COM (comentário).
const DROP_JPEG = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break; // início dos dados da imagem: copia o resto como está
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return b; // estrutura inesperada: não arrisca corromper
    if (!DROP_JPEG.has(marker)) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  out.push(b.subarray(i));
  return Buffer.concat(out);
}

const DROP_PNG = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const end = i + 12 + len;
    if (end > b.length) return b;
    if (!DROP_PNG.has(b.toString('latin1', i + 4, i + 8))) out.push(b.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}
