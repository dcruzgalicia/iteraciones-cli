import { basename, dirname, join, relative } from 'node:path';
import { resolveCollectionFile } from '../builder/collection-files.js';
import { loadSlugIndex } from '../builder/discover.js';
import { printFlags } from '../builder/image-flags.js';
import { relImageMapFor, rewriteImagePaths } from '../builder/image-processor.js';
import { buildLatexPandocContent, mergeConfigImages, preprocessDocumentImages } from '../builder/latex-composer.js';
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
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fail, logSuccess } from '../lib/logger.js';
import { posix, resolvePath } from '../lib/paths.js';

/** Formatos de entrada de pandoc (más el cuerpo fusionado, que no usa pandoc). */
const FORMATS = ['latex', 'html', 'epub', 'markdown'] as const;

async function readSourceFm(text: string, label: string): Promise<Record<string, unknown>> {
  const { yaml } = splitFrontmatter(text);
  if (yaml === undefined) return {};
  try {
    return (Bun.YAML.parse(yaml) ?? {}) as Record<string, unknown>;
  } catch {
    throw new BuildError(`frontmatter inválido en "${label}"`);
  }
}

function assertCollectionFiles(fm: Record<string, unknown>, label: string): string[] {
  if (fm.type !== 'collection') {
    throw new BuildError(`"${label}" no es una collection (type: ${typeof fm.type === 'string' ? fm.type : 'sin type'})`);
  }
  const files = Array.isArray(fm.files) ? fm.files.filter((f): f is string => typeof f === 'string') : [];
  if (files.length === 0) throw new BuildError(`"${label}": la collection no tiene archivos en files`);
  return files;
}

/** La collection original + los campos derivados que arma el build, en el mismo orden. */
async function readCollectionSource(cwd: string, input: string) {
  const inputPath = resolvePath(cwd, input);
  const relativePath = posix(relative(cwd, inputPath));
  let text: string;
  try {
    text = await Bun.file(inputPath).text();
  } catch {
    throw new BuildError(`no se pudo leer "${input}"`);
  }

  const fm = await readSourceFm(text, input);
  const rawFiles = assertCollectionFiles(fm, input);
  // files[] resueltos contra la raíz (#2443), collectionCreator propio y
  // creator agregado de los files — tal como los deja el build.
  const files: string[] = [];
  for (const file of rawFiles) {
    const resolved = await resolveCollectionFile(file, relativePath, cwd);
    files.push(resolved.ok ? resolved.rootRelative : file);
  }
  fm.files = files;
  // #2446: collectionCreator viaja tal cual del origen; creator es la unión de
  // los creator de files[], la misma que imprime build en todos los formatos.
  fm.creator = await aggregateCollectionCreators({ files }, cwd);
  return { inputPath, relativePath, text, fm, files };
}

export interface MergeContext {
  doc: BuildDocument;
  relImageMap: Map<string, string>;
  docDir: string;
}

/**
 * Reproduce la pasada de imágenes del build hacia `assets/images`, con las
 * mismas medidas de página y el mismo recorte. La comparten `iteraciones merge`
 * y `iteraciones markdown`: los dos reconstruyen el mapa que el build calcula,
 * y si el formato del href cambia tiene que cambiar en los dos a la vez.
 */
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
  // #2483: la página HTML son tarjetas (los mismos hrefs que resuelve el build):
  // una con los datos de la collection y una por file con su enlace. El EPUB
  // sigue recibiendo la fusión completa.
  if (format === 'html') return collectionCardsContent(entries, memberHrefs, src.text);
  const base = collectionBaseContent(entries, format === 'markdown' ? 'markdown' : 'html', src.text);
  // #2460: latex/html/epub no reescriben el texto crudo (lo reescribe el filtro
  // 04-image-paths sobre el AST); el markdown de dist no pasa por pandoc (#2436).
  return format === 'markdown' ? rewriteImagePaths(base, ctx.relImageMap, ctx.docDir) : base;
}

/**
 * #2445 — `iteraciones merge <collection.md> --format <fmt> -o <out>` escribe
 * `.iteraciones/collections/<slug>.<fmt>.md`: el markdown EXACTO que pandoc
 * recibe por stdin durante `iteraciones build`. Siempre sobre los archivos
 * originales de `files[]` (nunca sobre las copias de dist), con los mismos
 * compositores que usa el build, así que la salida es byte-idéntica.
 */
export async function runMerge(cwd: string, input: string, options: { output?: string; format?: string }): Promise<void> {
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
    // El outSlug del build es el stem del `-o` sin la extensión de formato
    // (`.iteraciones/collections/<slug>.<format>.md`): con el mismo prefijo,
    // las imágenes que escribe este comando se llaman igual que las del build.
    const stem = basename(output, '.md');
    const outSlug = stem.endsWith(`.${format}`) ? stem.slice(0, -(format.length + 1)) : stem;
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
    // #2483: los enlaces de las tarjetas HTML salen de los mismos slugs que usa
    // el discovery del build, así `merge --format html` sigue siendo byte-idéntico.
    const memberHrefs = format === 'html' ? memberHtmlHrefs(src.relativePath, entries, await loadSlugIndex(cwd)) : new Map<string, string>();
    await writeOutput(output, await composeFor(format, src, entries, siteConfig, ctx, memberHrefs));
    logSuccess(`${input} [--format ${format}] → ${options.output}`, 'merge');
  } catch (err) {
    fail('merge', err);
  }
}
