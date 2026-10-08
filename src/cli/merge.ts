import { basename, dirname, join, relative } from 'node:path';
import { resolveCollectionFile } from '../builder/collection-files.js';
import { loadSlugIndex } from '../builder/discover.js';
import { relImageMapFor, rewriteImagePaths } from '../builder/image-processor.js';
import { buildLatexPandocContent, mergeConfigImages, preprocessDocumentImages } from '../builder/latex-composer.js';
import { detectPageSize } from '../builder/latex-preamble.js';
import { aggregateCollectionCreators } from '../builder/orchestrator.js';
import { ASSETS_IMAGES_DIR, DIST_FILES_DIR } from '../builder/output-layout.js';
import {
  type CollectionEntry,
  collectionBaseContent,
  collectionCardsContent,
  collectionScanContent,
  memberHtmlHrefs,
  readCollectionEntries,
} from '../builder/pipeline-formats.js';
import { writeOutput } from '../builder/pipeline-io.js';
import { loadPreambleFilters, resolveEffectiveDisabledPreamble } from '../builder/preamble-loader.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { computeActiveFormats, resolveDisabledPreambleConfig, toActiveFormats } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fail, logSuccess } from '../lib/logger.js';
import { posix, resolvePath } from '../lib/paths.js';

const FORMATS = ['latex', 'html', 'epub', 'markdown'] as const;

async function printFlags(siteConfig: SiteConfig, cwd: string) {
  const active = toActiveFormats(computeActiveFormats(siteConfig.format));
  if (!active.pdf && !active.latex) return { pageDimensions: detectPageSize([]), cropActive: false, pdfxActive: false };
  const preamble = await loadPreambleFilters(resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(siteConfig)), cwd, 'file');
  return {
    pageDimensions: detectPageSize(preamble),
    cropActive: preamble.some((f) => f.name === '98-crop'),
    pdfxActive: preamble.some((f) => f.name === '99-pdfx'),
  };
}

async function readSourceFm(text: string, label: string): Promise<Record<string, unknown>> {
  const { yaml } = splitFrontmatter(text);
  if (yaml === undefined) return {};
  const { value, error } = parseYamlWithPosition(yaml);
  if (error) throw new BuildError(`frontmatter inválido en "${label}": ${error}`);
  return (value ?? {}) as Record<string, unknown>;
}

function assertCollectionFiles(fm: Record<string, unknown>, label: string): string[] {
  if (fm.type !== 'collection') {
    throw new BuildError(`"${label}" no es una collection (type: ${typeof fm.type === 'string' ? fm.type : 'sin type'})`);
  }
  const files = Array.isArray(fm.files) ? fm.files.filter((f): f is string => typeof f === 'string') : [];
  if (files.length === 0) throw new BuildError(`"${label}": la collection no tiene archivos en files`);
  return files;
}

export interface SourceDocument {
  inputPath: string;
  relativePath: string;
  text: string;
}

export async function readSourceDocument(cwd: string, input: string): Promise<SourceDocument> {
  const inputPath = resolvePath(cwd, input);
  let text: string;
  try {
    text = await Bun.file(inputPath).text();
  } catch {
    throw new BuildError(`no se pudo leer "${input}"`);
  }
  return { inputPath, relativePath: posix(relative(cwd, inputPath)), text };
}

async function readCollectionSource(cwd: string, input: string) {
  const { inputPath, relativePath, text } = await readSourceDocument(cwd, input);

  const fm = await readSourceFm(text, input);
  const rawFiles = assertCollectionFiles(fm, input);

  const files: string[] = [];
  for (const file of rawFiles) {
    const resolved = await resolveCollectionFile(file, relativePath, cwd);
    files.push(resolved.ok ? resolved.rootRelative : file);
  }
  fm.files = files;

  fm.creator = await aggregateCollectionCreators({ files }, cwd);
  return { inputPath, relativePath, text, fm, files };
}

export interface MergeContext {
  doc: BuildDocument;
  relImageMap: Map<string, string>;
  docDir: string;
}

export async function buildImagesContext(opts: {
  cwd: string;
  siteConfig: SiteConfig;
  content: string;
  fm: Record<string, unknown>;
  filePath: string;
  relativePath: string;
  assetsDir: string;
  outSlug: string;
}): Promise<MergeContext> {
  const { cwd, siteConfig, content, fm, filePath, relativePath, assetsDir, outSlug } = opts;
  const flags = await printFlags(siteConfig, cwd);
  const doc = { filePath, relativePath, frontmatter: fm } as unknown as BuildDocument;
  const images = await preprocessDocumentImages(
    content,
    doc,
    mergeConfigImages(fm, siteConfig.format?.pdf, siteConfig, cwd),
    flags.pageDimensions,
    flags.cropActive,
    flags.pdfxActive,
    assetsDir,
    outSlug,
  );
  return { doc, relImageMap: relImageMapFor(images.imageMap), docDir: dirname(filePath) };
}

async function composeFor(
  format: string,
  src: Awaited<ReturnType<typeof readCollectionSource>>,
  entries: CollectionEntry[],
  siteConfig: SiteConfig,
  ctx: MergeContext,
  memberHrefs: Map<string, string>,
): Promise<string> {
  if (format === 'latex') {
    const pageNumber = (src.fm.pageNumber ?? siteConfig.format?.pdf?.pageNumber ?? siteConfig.pageNumber) as string | undefined;
    return buildLatexPandocContent(collectionBaseContent(entries, 'latex', src.text, pageNumber), ctx.doc, {
      fm: src.fm,
      formatCfg: siteConfig.format?.pdf,
      siteConfig,
    });
  }

  if (format === 'html') return collectionCardsContent(entries, memberHrefs, src.text);
  const base = collectionBaseContent(entries, format === 'markdown' ? 'markdown' : 'html', src.text);

  return format === 'markdown' ? rewriteImagePaths(base, ctx.relImageMap, ctx.docDir) : base;
}

export async function runMerge(cwd: string, input: string, options: { output?: string; format?: string; slug?: string }): Promise<void> {
  try {
    const format = options.format;
    if (format === undefined || format === '') throw new BuildError(`falta --format (-f): esperado ${FORMATS.join(' | ')}`);
    if (!(FORMATS as readonly string[]).includes(format)) throw new BuildError(`formato desconocido "${format}"; esperado: ${FORMATS.join(' | ')}`);
    if (options.output === undefined || options.output === '') throw new BuildError('falta --output (-o): indica la ruta de salida');

    const src = await readCollectionSource(cwd, input);
    const siteConfig = await loadSiteConfig(cwd);
    const entries = await readCollectionEntries(src.files, src.relativePath, [cwd, join(cwd, dirname(src.relativePath))]);
    if (entries.length === 0) throw new BuildError(`"${input}": los archivos de files no tienen contenido`);

    const output = resolvePath(cwd, options.output);

    const stem = basename(output, '.md');
    const outSlug = options.slug ?? (stem.endsWith(`.${format}`) ? stem.slice(0, -(format.length + 1)) : stem);
    const distRoot = join(cwd, DIST_FILES_DIR);
    const outDir = dirname(src.relativePath) === '.' ? distRoot : join(distRoot, dirname(src.relativePath));
    const ctx = await buildImagesContext({
      cwd,
      siteConfig,
      content: collectionScanContent(entries, src.text),
      fm: src.fm,
      filePath: src.inputPath,
      relativePath: src.relativePath,
      assetsDir: join(outDir, ASSETS_IMAGES_DIR),
      outSlug,
    });

    const memberHrefs = format === 'html' ? memberHtmlHrefs(src.relativePath, entries, await loadSlugIndex(cwd)) : new Map<string, string>();
    await writeOutput(output, await composeFor(format, src, entries, siteConfig, ctx, memberHrefs));
    logSuccess(`${input} [--format ${format}] → ${options.output}`, 'merge');
  } catch (err) {
    fail('merge', err);
  }
}
