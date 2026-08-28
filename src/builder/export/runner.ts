import { existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ExportError, PANDOC_ERROR_CODES } from '../../lib/errors.js';
import { fmBool } from '../../lib/frontmatter-fields.js';
import { execPandoc, MD_READER } from '../../lib/pandoc-runner.js';
import { exec, ProcessSpawnError, ProcessTimeoutError } from '../../lib/run.js';
import type { LuaFilterGroup } from '../filter-resolver.js';
import {
  citationCompileArgs,
  citationPortableMetadataArgs,
  creatorArgs,
  dateArg,
  effectiveLanguage,
  languageArg,
  titleArg,
} from '../pandoc-metadata.js';
import type { ExportDocument } from './types.js';

/** Extensiones auxiliares que latexmk deja junto al .tex compilado. */
export const LATEXMK_AUX_EXTENSIONS = ['.aux', '.bbl', '.bcf', '.blg', '.fls', '.run.xml', '.fdb_latexmk', '.out', '.toc', '.log'];

/** Límite de tiempo de una compilación latexmk: 10 minutos. */
const LATEXMK_TIMEOUT_MS = 600_000;

/**
 * Template XMP de override del paquete pdfx (recurso del paquete): incluye la
 * identificación `pdfxid:GTS_PDFXVersion` para PDF/X-1a (issue #1967). El
 * paquete la lee con `\includexmp{pdfx}` por la ruta de entrada (TEXINPUTS); al
 * copiarla al directorio de trabajo latexmk la encuentra antes que la del
 * sistema.
 */
const XMP_TEMPLATE_RESOURCE = join(import.meta.dir, '../../lib/resources/xmp/pdfx.xmp');

/**
 * Convierte el markdown original a EPUB3 usando pandoc (sin intermediario).
 * Los filtros semánticos y de usuario corren en la misma invocación, como en
 * el resto de las conversiones.
 *
 * Contrato de metadatos: doc.metadata (ExportMetadata) lleva los valores
 * efectivos del documento y fm el frontmatter crudo; language y toc del
 * frontmatter sobreescriben los defaults.
 */
export async function convertToEpub(
  content: string,
  outputPath: string,
  doc: ExportDocument,
  filters: LuaFilterGroup,
  toc?: boolean,
  fm: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const extraArgs: string[] = [];
  for (const f of [...filters.semantic, ...filters.user]) extraArgs.push('--lua-filter', f);
  extraArgs.push(...citationCompileArgs(doc.metadata.bibliography, doc.metadata.csl));
  // El TOC: el frontmatter (toc:) manda; la config aporta el default
  const tocActive = fmBool(fm.toc, toc ?? false);
  if (tocActive) extraArgs.push('--toc');

  // Metadatos efectivos: el frontmatter del documento fluye a pandoc; aquí solo
  // se complementa lo que no está en él o necesita un valor por defecto
  // (composición compartida en pandoc-metadata, #2175).
  extraArgs.push(languageArg(effectiveLanguage(fm, doc.metadata.language)));
  extraArgs.push(titleArg(doc.metadata.title));
  extraArgs.push(...creatorArgs(doc.metadata.creator));
  extraArgs.push(...dateArg((doc.metadata.dateIso ?? doc.metadata.date) || undefined));

  await execPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'epub3', outputPath, extraArgs });
}

/**
 * Exporta un documento a Markdown via pandoc (markdown → markdown con los
 * filtros semánticos y de usuario, sin round-trip por otro formato). El
 * writer emite el YAML de los metadatos (frontmatter + complementos) con
 * --standalone.
 *
 * Contrato de metadatos: fm es el frontmatter crudo; lang, toc, bibliography
 * y csl del documento se complementan con los defaults de la configuración.
 */
export async function convertToMarkdown(
  content: string,
  outputPath: string,
  doc: ExportDocument,
  filters: LuaFilterGroup,
  cwd: string,
  fm: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const extraArgs: string[] = [];
  for (const f of [...filters.semantic, ...filters.user]) extraArgs.push('--lua-filter', f);

  // Metadatos complementarios: el frontmatter del documento fluye a pandoc y el
  // writer markdown emite el YAML resultante (frontmatter + estos campos) con
  // --standalone (sin él, el writer omite el metadata en la salida). Las rutas
  // de bibliografía/CSL se emiten relativas al proyecto: el export es portable
  // (mover el proyecto no rompe las citas; una ruta absoluta sí).
  extraArgs.push('--standalone');
  extraArgs.push(languageArg(effectiveLanguage(fm, doc.metadata.language)));
  extraArgs.push(...dateArg(doc.metadata.date || undefined));
  const tocActive = fmBool(fm.toc, doc.metadata.toc);
  if (tocActive) {
    extraArgs.push('--metadata=toc:true');
    if (doc.metadata.tocDepth && doc.metadata.tocDepth > 0) extraArgs.push(`--metadata=toc-depth:${doc.metadata.tocDepth}`);
  }
  extraArgs.push(...citationPortableMetadataArgs(doc.metadata.bibliography, doc.metadata.csl, cwd));

  const stdout = await execPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'markdown', extraArgs });
  await Bun.write(outputPath, stdout);
}

/**
 * Compila el .tex completo de un documento con latexmk.
 * @param fullTexPath Ruta absoluta al .tex completo (preámbulo + cuerpo).
 * @param sourcePath Ruta del .md original (solo para mensajes de error).
 * @param pdfDir Directorio de salida de latexmk (`.iteraciones/tmp/pdf/<dir>/slot-<n>`),
 * aislado por slot de concurrencia para evitar carreras del XMP (issue #1967).
 * @param slug Jobname de latexmk.
 * @param biberCacheDir Directorio de caché de biber (por slot de concurrencia).
 * @param pdfDest Ruta destino del .pdf en dist/ (rename final).
 * @param onSpawn Notifica el pid de latexmk justo tras el spawn (el pool PDF
 * lo registra para poder matar el árbol si quiesce vence su timeout).
 */
export async function convertToPdf(
  fullTexPath: string,
  sourcePath: string,
  pdfDir: string,
  slug: string,
  biberCacheDir?: string,
  pdfDest?: string,
  onSpawn?: (pid: number) => void,
): Promise<void> {
  if (!(await Bun.file(fullTexPath).exists())) {
    throw new ExportError('no se encontró el archivo .tex generado', sourcePath, '');
  }

  const biberCache = biberCacheDir ?? join(pdfDir, 'biber', slug);
  await mkdir(biberCache, { recursive: true });
  const logPath = join(pdfDir, `${slug}.log`);

  // Override del template XMP de pdfx: el paquete lo lee con `\includexmp{pdfx}`
  // por la ruta de entrada, así que el recurso se copia al directorio de trabajo
  // y se expone vía TEXINPUTS (la ':' final conserva los paths default). Solo
  // afecta a builds con 99-pdfx activo (que es quien carga el paquete pdfx).
  // latexmk exige que el -outdir exista; el directorio se crea siempre (el pool
  // lo aísla por slot de concurrencia).
  await mkdir(pdfDir, { recursive: true });
  if (existsSync(XMP_TEMPLATE_RESOURCE)) {
    await copyFile(XMP_TEMPLATE_RESOURCE, join(pdfDir, 'pdfx.xmp'));
  }

  let result: Awaited<ReturnType<typeof exec>>;
  try {
    // `cwd` y `-outdir` apuntan al mismo directorio de trabajo aislado por slot:
    // el override pdfx.xmp y el pdfx.xmpi parcheado por \includexmp/xmpincl se
    // resuelven y escriben ahí, sin competir con otros slots paralelos (el nombre
    // pdfx.xmpi es fijo — issue #1967). Las rutas del .tex (bibliografía) son
    // absolutas, así que el cwd nuevo es seguro.
    result = await exec('latexmk', ['-pdf', '-interaction=nonstopmode', `-outdir=${pdfDir}`, `-jobname=${slug}`, fullTexPath], {
      timeoutMs: LATEXMK_TIMEOUT_MS,
      cwd: pdfDir,
      // La caché de biber se aísla por slot de concurrencia
      env: { PAR_GLOBAL_TEMP: biberCache, TEXINPUTS: `${pdfDir}:` },
      onSpawn,
    });
  } catch (err) {
    if (err instanceof ProcessSpawnError) {
      // Error esperado: latexmk no está en PATH; mensaje accionable en español
      throw new ExportError(
        'latexmk no está disponible en PATH. Instala MacTeX full: https://tug.org/mactex/',
        sourcePath,
        '',
        PANDOC_ERROR_CODES.envMissing,
      );
    }
    if (err instanceof ProcessTimeoutError) {
      // Una compilación latexmk colgada no debe colgar el build: el timeout
      // de exec() la terminó.
      throw new ExportError(
        `latexmk no terminó en ${LATEXMK_TIMEOUT_MS / 60000} minutos y fue terminado. Revisa el log en: ${logPath}`,
        sourcePath,
        '',
      );
    }
    throw err;
  }

  if (result.exitCode !== 0) {
    // El mensaje no incluye la ruta: el dispatcher la añade una sola vez
    // ("en \"<sourcePath>\""). El stderr se recorta a la línea clave del
    // error de TeX más la referencia al log completo.
    const log = `${result.stdout}\n${result.stderr}`;
    const m = log.match(/^! .*$/m);
    const detail = m ? m[0] : `exit ${result.exitCode}`;
    throw new ExportError(`latexmk falló al generar el PDF: ${detail}`, sourcePath, `Revisa el log completo en: ${logPath}`);
  }

  // Éxito: eliminar los auxiliares de latexmk (el .log solo se referencia en
  // errores), el parche XMP (pdfx.xmpi) ya embebido, el pdfx.xmp de entrada y el
  // .xmpdata que escribe el bloque filecontents del .tex (issue #1970). Sin esto,
  // el área de trabajo acumula basura indefinidamente.
  await Promise.all(
    [
      ...LATEXMK_AUX_EXTENSIONS.map((ext) => join(pdfDir, `${slug}${ext}`)),
      join(pdfDir, 'pdfx.xmp'),
      join(pdfDir, 'pdfx.xmpi'),
      join(pdfDir, `${slug}.xmpdata`),
    ].map((p) => rm(p, { force: true }).catch(() => {})),
  );

  // El .pdf final se publica en dist/ (el área de trabajo es efímera).
  if (pdfDest) {
    await mkdir(dirname(pdfDest), { recursive: true });
    await rename(join(pdfDir, `${slug}.pdf`), pdfDest);
  }
}
