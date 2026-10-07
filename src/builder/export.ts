import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { formatHumanDate } from '../lib/date.js';
import { ExportError, PANDOC_ERROR_CODES } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fmBool, fmString } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, imagePathsEnv, MD_READER } from '../lib/pandoc-runner.js';
import { escapeRegExp } from '../lib/paths.js';
import { exec, mapWithConcurrency, ProcessSpawnError, ProcessTimeoutError } from '../lib/run.js';
import { prepareArgv, recordSupportCommand } from '../lib/script-recorder.js';
import type { LuaFilterGroup } from './filter-resolver.js';
import { citationCompileArgs, metadataArgs } from './pandoc-metadata.js';
import { preparePaths, xmpDirsFor } from './prepare.js';
import type { BuildDocument } from './types.js';

export interface ExportMetadata {
  title: string;
  creator: string[];
  date?: string;
  dateIso?: string;
  language: string;
  bibliography?: string;
  csl?: string;
  toc: boolean;
  tocDepth?: number;
}

export interface ExportDocument {
  filePath: string;
  relativePath: string;
  metadata: ExportMetadata;
  slug?: string;
}

export function assembleExportDocument(
  doc: BuildDocument,
  language: string,
  globalBibliography?: string,
  globalCsl?: string,
  toc?: boolean,
): ExportDocument {
  const metadata: ExportMetadata = {
    title: doc.frontmatter.title || 'Sin título',
    creator: doc.frontmatter.creator,
    date: formatHumanDate(doc.frontmatter.date) ?? undefined,
    dateIso: doc.frontmatter.date,
    language,
    bibliography: globalBibliography,
    csl: globalCsl,
    toc: toc ?? false,
    tocDepth: 1,
  };

  return {
    filePath: doc.filePath,
    relativePath: doc.relativePath,
    metadata,
    slug: doc.slug,
  };
}

export const LATEXMK_AUX_EXTENSIONS = ['.aux', '.bbl', '.bcf', '.blg', '.fls', '.run.xml', '.fdb_latexmk', '.out', '.toc', '.log'];

const LATEXMK_TIMEOUT_MS = 600_000;

export async function convertToEpub(
  content: string,
  outputPath: string,
  doc: ExportDocument,
  filters: LuaFilterGroup,
  toc?: boolean,
  fm: Record<string, unknown> = {},
  inputTarget?: string,
  imagePaths?: string,
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

  extraArgs.push(
    ...metadataArgs([
      { key: 'language', value: fmString(fm.language, doc.metadata.language) },
      { key: 'title', value: doc.metadata.title },
      { key: 'creator', value: doc.metadata.creator },
      { key: 'date', value: (doc.metadata.dateIso ?? doc.metadata.date) || undefined },
    ]),
  );

  await execPandoc({
    input: content,
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'epub3',
    outputPath,
    extraArgs,
    inputTarget,
    env: imagePathsEnv(imagePaths),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
    await Bun.write(outputPath, content);
    return;
  }

  const outFm: Record<string, unknown> = { ...base, ...fm };
  if (merge) {
    outFm.type = 'file';
    delete outFm.files;
  }
  if (outFm.language === undefined) outFm.language = doc.metadata.language;

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
  noBibtex = false,
  onSpawn?: (pid: number) => void,
): Promise<void> {
  if (!(await Bun.file(fullTexPath).exists())) {
    throw new ExportError('no se encontró el archivo .tex generado', sourcePath, '');
  }

  const biberCache = biberCacheDir ?? join(pdfDir, 'biber', slug);
  const xmpDirs = xmpDirsFor([pdfDir]);
  await preparePaths([biberCache, pdfDir], xmpDirs);
  recordSupportCommand('pdf', slug, prepareArgv([biberCache, pdfDir], xmpDirs));
  const logPath = join(pdfDir, `${slug}.log`);

  let result: Awaited<ReturnType<typeof exec>>;
  try {
    const args = ['-pdf', '-interaction=nonstopmode', ...(noBibtex ? ['-nobibtex'] : []), `-outdir=${pdfDir}`, `-jobname=${slug}`, fullTexPath];
    result = await exec('latexmk', args, {
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

  if (pdfDest) {
    await collectPdf(pdfDir, pdfDest);
    recordSupportCommand('pdf', slug, ['iteraciones', 'pdf', 'collect', pdfDir, '-o', pdfDest]);
  } else {
    await cleanPdfSlot(pdfDir, slug);
  }
}

async function cleanPdfSlot(slotDir: string, job: string): Promise<void> {
  const auxPaths = [
    ...LATEXMK_AUX_EXTENSIONS.map((ext) => join(slotDir, `${job}${ext}`)),
    join(slotDir, 'pdfx.xmp'),
    join(slotDir, 'pdfx.xmpi'),
    join(slotDir, `${job}.xmpdata`),
  ];
  await Promise.all(auxPaths.map((p) => rm(p, { force: true }).catch(() => {})));
}

export async function collectPdf(slotDir: string, output: string): Promise<void> {
  await cleanPdfSlot(slotDir, basename(output, '.pdf'));
  await mkdir(dirname(output), { recursive: true });
  await rename(join(slotDir, `${basename(output, '.pdf')}.pdf`), output);
}

const COVER_TIMEOUT_MS = 30_000;

interface CoverImageEntry {
  pdfPath: string;
  pngPath: string;
}

function coverPrefix(pngPath: string): string {
  return `.cover-${basename(pngPath, '.png')}`;
}

export async function collectCover(pngPath: string): Promise<string | undefined> {
  const dir = dirname(pngPath);
  const stem = basename(pngPath, '.png');
  const pattern = new RegExp(`^\\.cover-${escapeRegExp(stem)}-\\d+\\.png$`);
  const entries = await readdir(dir);
  const produced = entries.find((f) => pattern.test(f));
  if (produced === undefined) return undefined;
  await rename(join(dir, produced), pngPath);
  for (const f of await readdir(dir)) {
    if (pattern.test(f)) await rm(join(dir, f), { force: true }).catch(() => {});
  }
  return produced;
}

export async function generateCoverImages(entries: CoverImageEntry[]): Promise<void> {
  await mapWithConcurrency(entries, Math.min(4, Math.max(1, cpus().length)), async ({ pdfPath, pngPath }) => {
    try {
      await mkdir(dirname(pngPath), { recursive: true });
      await exec('pdftoppm', ['-png', '-f', '1', '-l', '1', pdfPath, join(dirname(pngPath), coverPrefix(pngPath))], {
        timeoutMs: COVER_TIMEOUT_MS,
      });
      const produced = await collectCover(pngPath);
      if (produced === undefined) {
        logWarning(`pdftoppm no produjo la imagen de portada de "${basename(pdfPath)}"`, 'build');
        return;
      }

      recordSupportCommand('covers', join(dirname(pngPath), coverPrefix(pngPath)), ['mv', join(dirname(pngPath), produced), pngPath]);
    } catch {
      logWarning(`no se pudo generar la imagen de portada de "${basename(pdfPath)}" (¿pdftoppm instalado?)`, 'build');
    }
  });
}
