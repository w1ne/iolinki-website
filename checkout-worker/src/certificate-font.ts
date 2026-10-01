import fontkit from '@pdf-lib/fontkit';
import fontBytes from '../fonts/DejaVuSans.ttf';

export const certificateFontBytes = new Uint8Array(fontBytes);
const face = fontkit.create(certificateFontBytes);
if (!('hasGlyphForCodePoint' in face)) throw Error('unsupported certificate font');

/** Use the same glyph coverage for prepayment input validation and PDF output. */
export function supportsCertificateText(text: string): boolean {
  return [...text].every(ch => ch === '\n' || ch === '\r' || face.hasGlyphForCodePoint(ch.codePointAt(0)!));
}
