import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PandocError } from '../../lib/errors.js';
import { logWarning } from '../../lib/logger.js';
import { runPandoc } from '../../lib/pandoc-runner.js';
import { LATEXMK_AUX_EXTENSIONS } from '../cleanup.js';
import { type LuaFilterGroup, MD_READER, metadataValue } from '../render.js';
import { type ReproCtx, writeEpubReproScript, writeMarkdownReproScript } from '../repro.js';
import type { ExportDocument } from './types.js';

/** Límite de tiempo de una compilación latexmk: 10 minutos. */
const LATEXMK_TIMEOUT_MS = 600_000;

/**
 * Convierte el markdown original a EPUB3 usando pandoc (sin intermediario).
 * Los filtros semánticos y de usuario corren en la misma invocación, como en
 * el resto de las conversiones.
 */
export async function convertToEpub(
  content: string,
  outputPath: string,
  doc: ExportDocument,
  filters: LuaFilterGroup,
  toc?: boolean,
  fm: Record<string, unknown> = {},
  repro?: ReproCtx,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const extraArgs: string[] = [];
  for (const f of [...filters.semantic, ...filters.user]) extraArgs.push('--lua-filter', f);
  if (doc.metadata.bibliography) {
    extraArgs.push('--citeproc');
  }
  // El TOC: el frontmatter (toc:) manda; la config aporta el default
  const tocActive = typeof fm.toc === 'boolean' ? fm.toc : toc;
  if (tocActive) extraArgs.push('--toc');

  // Metadatos efectivos: el frontmatter del documento fluye a pandoc; aquí solo
  // se complementa lo que no está en él o necesita un valor por defecto.
  const lang = typeof fm.lang === 'string' && fm.lang ? (fm.lang as string) : doc.metadata.lang;
  extraArgs.push(`--metadata=lang:${lang}`);
  extraArgs.push(`--metadata=title:${metadataValue(doc.metadata.title)}`);
  for (const author of doc.metadata.author) {
    extraArgs.push(`--metadata=author:${metadataValue(author)}`);
  }
  const date = doc.metadata.dateIso ?? doc.metadata.date;
  if (date) extraArgs.push(`--metadata=date:${metadataValue(date)}`);

  if (repro) {
    // El orden real de runPandoc: --citeproc/--bibliography/--csl antes de extraArgs
    const reproArgs = [...extraArgs];
    if (doc.metadata.bibliography) {
      reproArgs.unshift('--bibliography', doc.metadata.bibliography);
      if (doc.metadata.csl) reproArgs.unshift('--csl', doc.metadata.csl);
      reproArgs.unshift('--citeproc');
    }
    await writeEpubReproScript(repro, doc, reproArgs);
  }

  await runPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'epub3', outputPath, extraArgs });
}

/**
 * Exporta un documento a Markdown via pandoc (markdown → markdown con los
 * filtros semánticos y de usuario, sin round-trip por otro formato).
 */
export async function convertToMarkdown(
  content: string,
  outputPath: string,
  doc: ExportDocument,
  filters: LuaFilterGroup,
  fm: Record<string, unknown> = {},
  repro?: ReproCtx,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const extraArgs: string[] = [];
  for (const f of [...filters.semantic, ...filters.user]) extraArgs.push('--lua-filter', f);

  // Metadatos complementarios: el frontmatter del documento fluye a pandoc y el
  // writer markdown emite el YAML resultante (frontmatter + estos campos) con
  // --standalone (sin él, el writer omite el metadata en la salida).
  const lang = typeof fm.lang === 'string' && fm.lang ? (fm.lang as string) : doc.metadata.lang;
  extraArgs.push('--standalone');
  extraArgs.push(`--metadata=lang:${lang}`);
  extraArgs.push(`--metadata=documentclass:${doc.metadata.documentclass}`);
  if (doc.metadata.date) extraArgs.push(`--metadata=date:${metadataValue(doc.metadata.date)}`);
  const tocActive = typeof fm.toc === 'boolean' ? fm.toc : doc.metadata.toc;
  if (tocActive) {
    extraArgs.push('--metadata=toc:true');
    if (doc.metadata.tocDepth && doc.metadata.tocDepth > 0) extraArgs.push(`--metadata=toc-depth:${doc.metadata.tocDepth}`);
  }
  if (doc.metadata.bibliography) {
    extraArgs.push(`--metadata=bibliography:${doc.metadata.bibliography}`);
  }
  if (doc.metadata.csl) {
    if (existsSync(doc.metadata.csl)) {
      extraArgs.push(`--metadata=csl:${doc.metadata.csl}`);
    } else {
      logWarning(`archivo CSL no encontrado: "${doc.metadata.csl}"`, 'export');
    }
  }

  const stdout = await runPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'markdown', extraArgs });
  if (repro) await writeMarkdownReproScript(repro, doc, extraArgs);
  await Bun.write(outputPath, stdout);
}

/**
 * Compila el .tex completo de un documento con latexmk.
 * @param fullTexPath Ruta absoluta al .tex completo (preámbulo + cuerpo).
 * @param sourcePath Ruta del .md original (solo para mensajes de error).
 * @param pdfDir Directorio de salida de latexmk (`.iteraciones/formats/pdf/<dir>`).
 * @param slug Jobname de latexmk.
 * @param biberCacheDir Directorio de caché de biber (por slot de concurrencia).
 */
export async function convertToPdf(
  fullTexPath: string,
  sourcePath: string,
  pdfDir: string,
  slug: string,
  biberCacheDir?: string,
  pdfDest?: string,
): Promise<void> {
  if (!(await Bun.file(fullTexPath).exists())) {
    throw new PandocError('no se encontró el archivo .tex generado', sourcePath, '');
  }

  const biberCache = biberCacheDir ?? join(pdfDir, 'biber', slug);
  await mkdir(biberCache, { recursive: true });
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['latexmk', '-pdf', '-interaction=nonstopmode', `-outdir=${pdfDir}`, `-jobname=${slug}`, fullTexPath], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PAR_GLOBAL_TEMP: biberCache },
    });
  } catch (err) {
    // Error esperado: latexmk no está en PATH (ENOENT); mensaje accionable en español
    throw new PandocError('latexmk no está disponible en PATH. Instala MacTeX full: https://tug.org/mactex/', sourcePath, String(err));
  }
  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new PandocError('No se pudo leer stdout de latexmk', sourcePath, '');
  }
  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new PandocError('No se pudo leer stderr de latexmk', sourcePath, '');
  }
  const outputPromise = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  // Una compilación latexmk colgada no debe colgar el build: el kill del
  // timeout resuelve proc.exited y clearTimeout siempre corre.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, LATEXMK_TIMEOUT_MS);
  const [stdout, stderr, exitCode] = await outputPromise;
  clearTimeout(timer);
  if (timedOut) {
    throw new PandocError(
      `latexmk no terminó en ${LATEXMK_TIMEOUT_MS / 60000} minutos y fue terminado. Revisa el log en: ${join(pdfDir, `${slug}.log`)}`,
      sourcePath,
      `${stdout}\n${stderr}`,
    );
  }

  if (exitCode !== 0) {
    // El mensaje no incluye la ruta: el dispatcher la añade una sola vez
    // ("en \"<sourcePath>\""). El stderr se recorta a la línea clave del
    // error de TeX más la referencia al log completo.
    const log = `${stdout}\n${stderr}`;
    const m = log.match(/^! .*$/m);
    const detail = m ? m[0] : `exit ${exitCode}`;
    throw new PandocError(`latexmk falló al generar el PDF: ${detail}`, sourcePath, `Revisa el log completo en: ${join(pdfDir, `${slug}.log`)}`);
  }

  // Éxito: eliminar los auxiliares de latexmk (el .log solo se referencia en
  // errores). Sin esto, el área de trabajo acumula basura indefinidamente.
  await Promise.all(LATEXMK_AUX_EXTENSIONS.map((ext) => rm(join(pdfDir, `${slug}${ext}`), { force: true }).catch(() => {})));

  // El .pdf final se publica en dist/ (el área de trabajo es efímera).
  if (pdfDest) {
    await mkdir(dirname(pdfDest), { recursive: true });
    await rename(join(pdfDir, `${slug}.pdf`), pdfDest);
  }
}
