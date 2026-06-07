import { join } from 'node:path';
import { mapWithConcurrency } from '../../output/concurrency.js';
import { writeFile } from '../../output/writer.js';
import { docHtmlPath } from '../slug.js';
import type { BuildContext, BuildDocument } from '../types.js';

/**
 * Escribe el HTML compuesto de cada documento en `ctx.outputDir`.
 * La limpieza del directorio es responsabilidad del orchestrator.
 * Retorna los documentos con `outputPath` asignado.
 */
export async function writeDocuments(docs: BuildDocument[], ctx: BuildContext): Promise<BuildDocument[]> {
  return mapWithConcurrency(docs, ctx.concurrency ?? 4, async (doc) => {
    if (doc.outputHtml === undefined) {
      throw new Error(`writeDocuments: outputHtml no definido en "${doc.relativePath}"`);
    }

    const outputPath = join(ctx.outputDir, docHtmlPath(doc));
    await writeFile(outputPath, doc.outputHtml);
    return { ...doc, outputPath };
  });
}
