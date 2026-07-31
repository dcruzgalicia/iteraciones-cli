import { join } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';

const content = await Bun.file(join(import.meta.dir, '../../lib/resources/preamble/02-environments.tex')).text();

export const description = 'Redefine center, flushright, flushleft sin espacio vertical extra';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(content.trimEnd());
  return preamble;
}
