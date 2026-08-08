import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { PandocError } from '../../lib/errors.js';
import { logWarning } from '../../lib/logger.js';
import { runPandoc } from '../../lib/pandoc-runner.js';
import type { ExportDocument } from './types.js';

/**
 * Construye el bloque YAML de metadatos que Pandoc inyectará en el documento.
 * Solo usada para exportación a Markdown.
 */
function buildYamlHeader(doc: ExportDocument): string {
  const { metadata } = doc;
  const header: Record<string, unknown> = { title: metadata.title };

  if (metadata.author.length > 0) {
    header.author = metadata.author.length === 1 ? metadata.author[0] : metadata.author;
  }

  if (metadata.date) header.date = metadata.date;
  header.lang = metadata.lang;
  header.documentclass = metadata.documentclass;
  if (metadata.toc) header.toc = true;
  if (metadata.tocDepth !== undefined && metadata.tocDepth > 0) {
    header['toc-depth'] = metadata.tocDepth;
  }

  // Bibliografía global (auto-descubierta de archivos .bib del proyecto)
  if (metadata.bibliography) {
    header.bibliography = metadata.bibliography;
  }
  if (metadata.csl) {
    if (existsSync(metadata.csl)) {
      header.csl = metadata.csl;
    } else {
      logWarning(`archivo CSL no encontrado: "${metadata.csl}"`, 'export');
    }
  }

  return `---\n${stringify(header, { defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE' })}---\n`;
}

/**
 * Convierte el AST canónico a EPUB3 usando pandoc (sin intermediario HTML).
 */
export async function convertToEpub(
  ast: Record<string, unknown>,
  outputPath: string,
  doc: ExportDocument,
  userFilters: string[],
  toc?: boolean,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const extraArgs: string[] = [];
  for (const f of userFilters) extraArgs.push('--lua-filter', f);
  if (doc.metadata.bibliography) {
    extraArgs.push('--citeproc');
  }
  if (toc) extraArgs.push('--toc');

  await runPandoc({ input: JSON.stringify(ast), sourcePath: doc.filePath, from: 'json', to: 'epub3', outputPath, extraArgs });
}

/**
 * Exporta un documento a Markdown via pandoc (json → markdown, sin round-trip por LaTeX).
 */
export async function convertToMarkdown(ast: Record<string, unknown>, outputPath: string, doc: ExportDocument, userFilters: string[]): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const extraArgs: string[] = [];
  for (const f of userFilters) extraArgs.push('--lua-filter', f);
  const stdout = await runPandoc({ input: JSON.stringify(ast), sourcePath: doc.filePath, from: 'json', to: 'markdown', extraArgs });
  const yamlHeader = buildYamlHeader(doc);
  await Bun.write(outputPath, yamlHeader + stdout);
}

/**
 * Compila el .tex completo de un documento con latexmk.
 * @param fullTexPath Ruta absoluta al .tex completo (preámbulo + cuerpo).
 * @param sourcePath Ruta del .md original (solo para mensajes de error).
 * @param pdfDir Directorio de salida de latexmk (`.iteraciones/formats/pdf/<dir>`).
 * @param slug Jobname de latexmk.
 * @param biberCacheDir Directorio de caché de biber (por slot de concurrencia).
 */
export async function convertToPdf(fullTexPath: string, sourcePath: string, pdfDir: string, slug: string, biberCacheDir?: string): Promise<void> {
  if (!(await Bun.file(fullTexPath).exists())) {
    throw new PandocError('no se encontró el archivo .tex generado', sourcePath, '');
  }

  const biberCache = biberCacheDir ?? join(pdfDir, 'biber', slug);
  await mkdir(biberCache, { recursive: true });
  const proc = Bun.spawn(['latexmk', '-pdf', '-interaction=nonstopmode', `-outdir=${pdfDir}`, `-jobname=${slug}`, fullTexPath], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PAR_GLOBAL_TEMP: biberCache },
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    // El mensaje no incluye la ruta: el dispatcher la añade una sola vez
    // ("en \"<sourcePath>\""). El stderr se recorta a la línea clave del
    // error de TeX más la referencia al log completo.
    const log = `${stdout}\n${stderr}`;
    const m = log.match(/^! .*$/m);
    const detail = m ? m[0] : `exit ${exitCode}`;
    throw new PandocError(`latexmk falló al generar el PDF: ${detail}`, sourcePath, `Revisa el log completo en: ${join(pdfDir, `${slug}.log`)}`);
  }
}
