import { join } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';

const content = await Bun.file(join(import.meta.dir, '../../lib/resources/preamble/06-hyphenation-rules.tex')).text();

export const description = 'Agrega \\hyphenation{} con nombres propios que no deben dividirse';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(content.trimEnd());
  return preamble;
}
