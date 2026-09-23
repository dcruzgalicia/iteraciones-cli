import { existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { ExportError, PANDOC_ERROR_CODES } from '../../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../../lib/frontmatter.js';
import { fmBool, fmString } from '../../lib/frontmatter-fields.js';
import { execPandoc, MD_READER } from '../../lib/pandoc-runner.js';
import { exec, ProcessSpawnError, ProcessTimeoutError } from '../../lib/run.js';
import type { LuaFilterGroup } from '../filter-resolver.js';
import { citationCompileArgs, creatorArgs, dateArg, languageArg, titleArg } from '../pandoc-metadata.js';
import type { ExportDocument } from './types.js';

export const LATEXMK_AUX_EXTENSIONS = ['.aux', '.bbl', '.bcf', '.blg', '.fls', '.run.xml', '.fdb_latexmk', '.out', '.toc', '.log'];

const LATEXMK_TIMEOUT_MS = 600_000;

const XMP_TEMPLATE_RESOURCE = join(import.meta.dir, '../../lib/resources/xmp/pdfx.xmp');

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
  extraArgs.push('--shift-heading-level-by=4');
  for (const f of [...filters.semantic, ...filters.user]) extraArgs.push('--lua-filter', f);
  extraArgs.push(...citationCompileArgs(doc.metadata.bibliography, doc.metadata.csl));
  const tocActive = fmBool(fm.toc, toc ?? false);
  if (tocActive) {
    extraArgs.push('--toc');
    extraArgs.push('--toc-depth=6');
  }

  extraArgs.push(languageArg(fmString(fm.language, doc.metadata.language)));
  extraArgs.push(titleArg(doc.metadata.title));
  extraArgs.push(...creatorArgs(doc.metadata.creator));
  extraArgs.push(...dateArg((doc.metadata.dateIso ?? doc.metadata.date) || undefined));

  await execPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'epub3', outputPath, extraArgs });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * #2436: el markdown de dist debe ser re-procesable, así que NO pasa por
 * pandoc: el roundtrip md→md desplazaba los headings (+4) y reescribía el
 * body, haciendo imposible la idempotencia. Se emite el frontmatter del
 * origen tal cual (solo se completa `language` desde el sitio) y el body
 * intacto, byte a byte.
 *
 * #2437: con `merge` (collections con format.markdown.merge) la salida deja de
 * ser reprocesable: `type` pasa a `file` y `files[]` se elimina, el body ya
 * viene fusionado.
 */
export async function convertToMarkdown(
  content: string,
  outputPath: string,
  doc: ExportDocument,
  fm: Record<string, unknown> = {},
  merge = false,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const { yaml, body } = splitFrontmatter(content);
  const parsed = yaml === undefined ? undefined : parseYamlWithPosition(yaml);
  const base = isRecord(parsed?.value) ? parsed.value : undefined;
  if (yaml !== undefined && base === undefined) {
    // Frontmatter ilegible: preservar el contenido tal cual (información > formato).
    await Bun.write(outputPath, content);
    return;
  }

  const outFm: Record<string, unknown> = { ...base, ...fm };
  if (merge) {
    outFm.type = 'file';
    delete outFm.files;
  }
  if (outFm.language === undefined) outFm.language = doc.metadata.language;
  // Si el origen no traía frontmatter, la línea en blanco separa el bloque del body.
  const separator = yaml === undefined ? '\n' : '';
  await Bun.write(outputPath, `---\n${stringify(outFm)}---\n${separator}${body}`);
}

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

  await mkdir(pdfDir, { recursive: true });
  if (existsSync(XMP_TEMPLATE_RESOURCE)) {
    await copyFile(XMP_TEMPLATE_RESOURCE, join(pdfDir, 'pdfx.xmp'));
  }

  let result: Awaited<ReturnType<typeof exec>>;
  try {
    result = await exec('latexmk', ['-pdf', '-interaction=nonstopmode', `-outdir=${pdfDir}`, `-jobname=${slug}`, fullTexPath], {
      timeoutMs: LATEXMK_TIMEOUT_MS,
      cwd: pdfDir,
      env: { PAR_GLOBAL_TEMP: biberCache, TEXINPUTS: `${pdfDir}:` },
      onSpawn,
    });
  } catch (err) {
    if (err instanceof ProcessSpawnError) {
      throw new ExportError(
        'latexmk no está disponible en PATH. Instala MacTeX full: https://tug.org/mactex/',
        sourcePath,
        '',
        PANDOC_ERROR_CODES.envMissing,
      );
    }
    if (err instanceof ProcessTimeoutError) {
      throw new ExportError(
        `latexmk no terminó en ${LATEXMK_TIMEOUT_MS / 60000} minutos y fue terminado. Revisa el log en: ${logPath}`,
        sourcePath,
        '',
      );
    }
    throw err;
  }

  if (result.exitCode !== 0) {
    const log = `${result.stdout}\n${result.stderr}`;
    const m = log.match(/^! .*$/m);
    const detail = m ? m[0] : `exit ${result.exitCode}`;
    throw new ExportError(`latexmk falló al generar el PDF: ${detail}`, sourcePath, `Revisa el log completo en: ${logPath}`);
  }

  await Promise.all(
    [
      ...LATEXMK_AUX_EXTENSIONS.map((ext) => join(pdfDir, `${slug}${ext}`)),
      join(pdfDir, 'pdfx.xmp'),
      join(pdfDir, 'pdfx.xmpi'),
      join(pdfDir, `${slug}.xmpdata`),
    ].map((p) => rm(p, { force: true }).catch(() => {})),
  );

  if (pdfDest) {
    await mkdir(dirname(pdfDest), { recursive: true });
    await rename(join(pdfDir, `${slug}.pdf`), pdfDest);
  }
}
