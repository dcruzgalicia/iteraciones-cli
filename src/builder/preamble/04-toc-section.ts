import { join } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';

const content = await Bun.file(join(import.meta.dir, '../../lib/resources/preamble/04-toc-section.tex')).text();

export const description = 'Redefine \\tableofcontents: \\section*, compensa espacio posterior de \\maketitle';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(content.trimEnd());
  return preamble;
}
