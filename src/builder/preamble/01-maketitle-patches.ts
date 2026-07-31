import { join } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';

const content = await Bun.file(join(import.meta.dir, '../../lib/resources/preamble/01-maketitle-patches.tex')).text();

export const description = 'Personaliza \\maketitle: 1+2 baselineskip, autor antes de titulo, titulo en mayusculas';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(content.trimEnd());
  return preamble;
}
