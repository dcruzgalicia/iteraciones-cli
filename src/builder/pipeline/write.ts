import { join } from 'node:path';
import { clean, writeFile } from '../../output/writer.js';
import type { BuildContext, BuildDocument } from '../types.js';

/**
 * Determina la ruta de salida de un documento: reemplaza la extensión `.md`
 * por `.html` y la une con `outputDir`.
 */
function resolveOutputPath(relativePath: string, outputDir: string): string {
  const htmlPath = relativePath.replace(/\.md$/, '.html');
  return join(outputDir, htmlPath);
}

/**
 * Limpia `ctx.outputDir`, luego escribe el HTML compuesto de cada documento.
 * Retorna los documentos con `outputPath` asignado.
 */
export async function writeDocuments(docs: BuildDocument[], ctx: BuildContext): Promise<BuildDocument[]> {
  await clean(ctx.outputDir);

  return Promise.all(
    docs.map(async (doc) => {
      if (doc.outputHtml === undefined) {
        throw new Error(`writeDocuments: outputHtml no definido en "${doc.relativePath}"`);
      }

      const outputPath = resolveOutputPath(doc.relativePath, ctx.outputDir);
      await writeFile(outputPath, doc.outputHtml);
      return { ...doc, outputPath };
    }),
  );
}
