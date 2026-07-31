import { join } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';

const content = await Bun.file(join(import.meta.dir, '../../lib/resources/preamble/03-toc-styling.tex')).text();

export const description = 'Personaliza el indice (TOC): nombre, espaciado, fuentes y lideres';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(content.trimEnd());
  return preamble;
}
