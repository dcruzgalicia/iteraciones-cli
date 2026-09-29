import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, fmTrimmedString, resolveBooleanField, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { isScriptCapture, recordSupportCommand, resolveScriptStdout } from '../lib/script-recorder.js';
import { extractFragment } from './collection-fragment.js';
import { computeSlug, htmlSlugFor, parseAuthors } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import type { ExportDocument } from './export/types.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import { imagePathsMap, rewriteFmImagePaths, rewriteImagePaths } from './image-processor.js';
import {
  buildTexDistribution,
  composeLatexFinalOutput,
  type ImagePreprocessResult,
  insertAuthorsBlock,
  type LatexPostManifest,
  markdownToLatex,
  mergeConfigImages,
  preprocessDocumentImages,
} from './latex-composer.js';
import { detectPageSize } from './latex-preamble.js';
import { ASSETS_CSS_FILE, ASSETS_IMAGES_DIR, docProducesFormat, primaryOutputExtension } from './output-layout.js';
import { formatLinksFor, parseFileFrontmatter, readMarkdownOrWarn, relativeHref, writeOutput } from './pipeline-io.js';
import type { ExportContext, FormatWorkSets, RenderContext } from './pipeline-setup.js';
import { htmlPageFromMarkdown } from './render.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';
import type { PdfXmpMetadata } from './xmpdata.js';
import { injectXmpMetadataIntoLatex } from './xmpdata.js';

interface DocumentOutputs {
  slug: string;
  outSlug: string;
  dir: string;
  fm: Record<string, unknown>;
  content: string;
  outBase(name: string): string;
}

function xmpMetadataFor(
  fm: Record<string, unknown>,
  lang: string,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
): PdfXmpMetadata {
  return {
    title: resolveStringField(fm, formatCfg, rootCfg, 'title'),
    authors: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'creator')),
    lang,
    dateIso: resolveStringField(fm, formatCfg, rootCfg, 'date'),
    subject: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'subject'))?.join(', '),
    publishers: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'publisher')),
    keywords: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'keywords')),
    description: resolveStringField(fm, formatCfg, rootCfg, 'description'),
    contributors: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'contributor')),
    identifier: resolveStringField(fm, formatCfg, rootCfg, 'identifier'),
    source: resolveStringField(fm, formatCfg, rootCfg, 'source'),
    relations: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'relation')),
    coverage: resolveStringField(fm, formatCfg, rootCfg, 'coverage'),
    rights: resolveStringField(fm, formatCfg, rootCfg, 'rights'),
    license: resolveStringField(fm, formatCfg, rootCfg, 'license'),
    doi: resolveStringField(fm, formatCfg, rootCfg, 'doi'),
    isbn: resolveStringField(fm, formatCfg, rootCfg, 'isbn'),
    abstract: resolveStringField(fm, formatCfg, rootCfg, 'abstract'),
  };
}

/**
 * #2460 — escribe el mapa de rutas que lee el filtro
 * `semantic/ast/04-image-paths` y devuelve su ruta para el env de pandoc. Un
 * fichero por documento y formato: los documentos se procesan en paralelo y
 * cada formato pide una forma distinta de la ruta (absoluta en latex/epub,
 * `./assets/images` en html). Vive en `.iteraciones/paths`, de donde lo relee
 * `bash build.sh`.
 */
async function writeImagePaths(
  doc: BuildDocument,
  cwd: string,
  format: 'latex' | 'html' | 'epub',
  imageMap: Map<string, string>,
  docDir: string,
  relativize: boolean,
): Promise<string> {
  const path = resolve(cwd, '.iteraciones', 'paths', `${doc.relativePath}.${format}.json`);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(imagePathsMap(imageMap, docDir, relativize))}\n`);
  return path;
}

async function emitLatexAndQueuePdf(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  sets: FormatWorkSets,
  images: ImagePreprocessResult,
  authorsBlock = '',
): Promise<void> {
  const { ctx, lang, warnedLangs, formatCfg, plan } = renderCtx;
  const latexOn = plan.activeFormats.latex;
  const pdfOn = plan.activeFormats.pdf;
  const { dir, outBase, outSlug, fm } = outputs;
  const texDistPath = outBase(`${outSlug}${primaryOutputExtension('latex')}`);

  const imagePaths = await writeImagePaths(doc, ctx.cwd, 'latex', images.imageMap, dirname(doc.filePath), false);
  const { tex: fullTex, processedImages } = await markdownToLatex(outputs.content, doc, {
    filters: exportCtx.filters,
    bibFiles: exportCtx.bibFiles,
    inputTarget: collectionPandocInput(doc, ctx.cwd, outSlug, 'latex'),
    imagePaths,
    templatePath:
      doc.frontmatter.type === 'collection'
        ? exportCtx.latexCollectionTemplatePath
        : doc.frontmatter.type === 'creator'
          ? exportCtx.latexCreatorTemplatePath
          : doc.frontmatter.type === 'intervention'
            ? exportCtx.latexInterventionTemplatePath
            : exportCtx.latexTemplatePath,
    fm,
    siteConfig: ctx.siteConfig,
    formatCfg: formatCfg?.pdf,
    biblatexAvailable: exportCtx.biblatexAvailable,
    warnedLangs,
    images,
    cwd: ctx.cwd,
  });
  const xmp = renderCtx.pdfxActive ? xmpMetadataFor(fm, lang, formatCfg?.pdf, ctx.siteConfig) : undefined;

  if (latexOn) {
    const texDir = dirname(texDistPath);
    const distribution = buildTexDistribution(processedImages);
    // #2459: el manifiesto es la serialización de los argumentos de
    // `composeLatexFinalOutput`, así que el build y `iteraciones post latex`
    // pasan por la misma función: ya no se puede añadir un paso en un sitio y
    // olvidarlo en el otro.
    const manifest: LatexPostManifest = {
      authorsBlock,
      xmp,
      distribution: Object.fromEntries(distribution),
      projectRoot: ctx.cwd,
      distRoot: ctx.outputDir,
      bundle: ctx.siteConfig.bundle === true,
    };
    const distTex = await composeLatexFinalOutput(fullTex, manifest, texDir);
    // #2445: el .sh no puede recomputar autores/XMP/distribución, así que el
    // build se los deja escritos en un manifiesto que `iteraciones post latex` lee.
    let post: string[] | undefined;
    if (isScriptCapture()) {
      const manifestPath = join(ctx.cwd, '.iteraciones', 'post', `${outSlug}.json`);
      await writeOutput(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      post = ['iteraciones', 'post', 'latex', '--post', manifestPath, '-o', texDistPath];
    }
    resolveScriptStdout(fullTex, texDistPath, distTex, post);
    await writeOutput(texDistPath, distTex);
  }

  if (pdfOn) {
    // #2459: el .tex de trabajo no es el de dist: latexmk trabaja con las rutas
    // absolutas de pandoc, así que solo se lleva el bloque de autores y el XMP
    // (PDF/X). El acabado de dist entero vive en `composeLatexFinalOutput`.
    const texWithAuthors = insertAuthorsBlock(fullTex, authorsBlock);
    const texWithXmp = xmp === undefined ? texWithAuthors : injectXmpMetadataIntoLatex(texWithAuthors, xmp);
    const texPath = join(exportCtx.pdfWorkDir, dir, `${outSlug}${primaryOutputExtension('latex')}`);
    await writeOutput(texPath, texWithXmp);
    sets.pdfJobs.push({
      dir,
      slug: outSlug,
      relativePath: doc.relativePath,
      texPath,
      pdfDest: outBase(`${outSlug}${primaryOutputExtension('pdf')}`),
      cover: resolveBooleanField(fm, formatCfg?.pdf, ctx.siteConfig, 'coverImage') === true,
      // #2419 — sin `.bib` no hay nada que citar: latexmk va con `-nobibtex`
      // (mismo criterio que apaga 11-bibliography en las plantillas).
      noBibtex: exportCtx.bibFiles.length === 0,
    });
  }
}

async function emitHtmlPage(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  discoveryIndex: Map<string, DiscoveryEntry>,
  imagePaths?: string,
): Promise<void> {
  const { ctx, plan, formatCfg, lang } = renderCtx;
  const htmlConfig = formatCfg?.html;
  const { dir, outBase, outSlug, slug, fm, content } = outputs;
  const cwd = ctx.cwd;

  const formats = formatLinksFor(plan, dir, outSlug);
  const hasHomePage = discoveryIndex.has('index.md');
  const htmlPath = outBase(`${outSlug}${primaryOutputExtension('html')}`);
  const html = await htmlPageFromMarkdown(content, doc, {
    cwd,
    inputTarget: collectionPandocInput(doc, cwd, outSlug, 'html'),
    imagePaths,
    vars: {
      title: doc.frontmatter.title || slug,
      siteTitle: htmlConfig?.site?.title ?? 'iteraciones',
      tagline: htmlConfig?.site?.description ?? 'escribir, compartir, re-existir',
      lang,
      theme: htmlConfig?.site?.theme,
      accent: htmlConfig?.site?.color,
      css: ctx.needsCss ? relativeHref(dir, ASSETS_CSS_FILE) : undefined,
      authorMeta: doc.frontmatter.creator.join(', '),
      docTitle: doc.frontmatter.title && doc.frontmatter.title !== 'Sin título' ? doc.frontmatter.title : undefined,
      subtitle: doc.frontmatter.subtitle,
      date: formatHumanDate(doc.frontmatter.date),
      homeHref: hasHomePage ? relativeHref(dir, 'index.html') : undefined,
      formats: formats.length > 0 ? formats : undefined,
      // #2483: la página de una collection no tiene tarjeta de contenido.
      collection: doc.frontmatter.type === 'collection',
    },
    siteConfig: ctx.siteConfig,
    templatePath: exportCtx.htmlTemplatePath,
    refsCardTemplate: exportCtx.refsCardTemplate,
    fm,
    bibOptions: exportCtx.bibOptions,
    luaFilters: exportCtx.filters,
    scriptOutputPath: htmlPath,
  });
  await writeOutput(htmlPath, html);
}

export type CollectionEntry = {
  /** ruta del `.md` de origen, relativa a la raíz del proyecto (#2483). */
  file: string;
  title: string;
  creator: string[];
  subtitle: string | undefined;
  type: string | undefined;
  lineLength: number | undefined;
  pages: number | undefined;
  body: string;
};

/**
 * Lee y parsea los archivos de una collection. Compartido entre el build
 * (#2437) y el subcomando `iteraciones merge`. Cada caller pasa sus bases:
 * el build va con [raíz, dir de la collection] (los files llegan normalizados
 * relativos a la raíz desde postProcessCollections; lo irresoluble cae al dir
 * de la collection y ambas rutas aparecen en el error) y merge con
 * [dir del .md de entrada, raíz] (#2443).
 */
export async function readCollectionEntries(files: string[], collectionPath: string, bases: string[]): Promise<CollectionEntry[]> {
  const entries: CollectionEntry[] = [];
  for (const file of files) {
    const candidates = [...new Set(bases.map((base) => join(base, file)))];
    let text: string | undefined;
    for (const candidate of candidates) {
      try {
        text = await Bun.file(candidate).text();
        break;
      } catch {}
    }
    if (text === undefined) {
      throw new BuildError(
        `collection "${collectionPath}": archivo configurado en files no encontrado: "${file}" (probado: ${candidates.join(', ')})`,
      );
    }
    const parsed = parseFileFrontmatter(text);
    // #2483: la ruta raíz-relativa del miembro viaja en la entrada; es la clave
    // con la que su tarjeta enlaza a su HTML (slug resuelto del discovery).
    const rootRelative = file.split(sep).join('/').replace(/^\.\//, '');
    if (parsed.body.trim()) entries.push({ file: rootRelative, ...parsed });
  }
  return entries;
}

async function readCollectionFiles(doc: BuildDocument, cwd: string): Promise<CollectionEntry[]> {
  const files = doc.frontmatter.files;
  if (!files || files.length === 0) return [];
  return readCollectionEntries(files, doc.relativePath, [cwd, join(cwd, dirname(doc.relativePath))]);
}

/**
 * #2452 — slug de cada miembro de `files[]`: da el nombre que su `.md` tiene en
 * dist, el mismo que usa su propia emisión standalone. El build lo resuelve con
 * su discovery y `iteraciones markdown` con `loadSlugIndex`, para que los dos
 * escriban exactamente el mismo `files[]`.
 */
export function memberSlugMap(rootFiles: string[], discoveryIndex: Map<string, DiscoveryEntry>): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const file of rootFiles) {
    const slug = discoveryIndex.get(file)?.slug;
    if (slug !== undefined) slugs.set(file, slug);
  }
  return slugs;
}

/**
 * #2452 — ruta de dist del `.md` de un miembro, en su nombre-nuevo
 * (`htmlSlugFor`): hacia ahí apunta `files[]` y de ahí lo lee el re-proceso.
 * Sin slug resuelto (el archivo no es un documento del proyecto) se conserva la
 * ruta de la fuente, como antes de #2452.
 */
function memberMarkdownPath(memberSlugs: Map<string, string> | undefined, outputDir: string, file: string): string {
  const slug = memberSlugs?.get(file);
  if (slug === undefined) return join(outputDir, normalize(file));
  return join(outputDir, dirname(file), `${htmlSlugFor(file, slug)}.md`);
}

/**
 * #2445/#2452 — el markdown de dist (#2436), con el composit compartido entre
 * `emitCollectionMarkdown` y `iteraciones markdown`: escribe el .md final y,
 * si la collection no se fusiona, reescribe `files[]` hacia el `.md` standalone
 * de cada miembro (su nombre-nuevo, escrito por el propio miembro). El build
 * graba aquí el argv que el .sh vuelve a ejecutar.
 */
export async function writeDistMarkdown(p: {
  /** el .md de origen, relativo a la raíz: es el argv del .sh. */
  label: string;
  content: string;
  outPath: string;
  outputDir: string;
  fm: Record<string, unknown>;
  exportDoc: ExportDocument;
  relImageMap: Map<string, string>;
  docDir: string;
  creatorLinks: { name: string; url: string }[];
  /** files[] raíz-relativos; ausente cuando no es una collection. */
  rootFiles?: string[];
  /** slug resuelto de cada miembro (`memberSlugMap`). */
  memberSlugs?: Map<string, string>;
  /** format.markdown.merge efectivo (solo collections). */
  merge: boolean;
  entries: CollectionEntry[];
}): Promise<void> {
  const { label, outPath, outputDir, rootFiles, merge } = p;
  const mdFm: Record<string, unknown> = { ...p.fm };
  if (rootFiles !== undefined) {
    // #2446: con merge:false el frontmatter original manda y `files[]` está ahí,
    // así que la unión de autores se recalcula en cada build y no viaja. Con
    // merge:true la collection pasa a `type: file`, pierde `files[]` y tanto el
    // byline como el crédito propio (collectionCreator) son irrecuperables:
    // ambos viajan.
    if (!merge) delete mdFm.creator;
    // #2446: la collection exporta su slug derivado. Sin él, un .md
    // re-procesado (con merge:true sale como type: file y el byline en creator)
    // lo recalcula desde `creator` y renombra la salida; el slug manual ya viaja
    // en el frontmatter. Se deriva aquí para que build y `iteraciones markdown`
    // escriban exactamente lo mismo.
    if (mdFm.slug === undefined) {
      const derived = computeSlug(
        { title: typeof mdFm.title === 'string' ? mdFm.title : undefined, creator: parseAuthors(mdFm.collectionCreator) },
        { fallbackPath: label },
      );
      if (derived !== undefined) mdFm.slug = derived;
    }
    const outDir = dirname(outPath);
    mdFm.files = rootFiles.map((f) => {
      if (p.memberSlugs !== undefined && !p.memberSlugs.has(f)) {
        logWarning(
          `"${label}": files contiene "${f}", que no forma parte de los documentos del proyecto; files[] conserva su nombre de origen`,
          'build',
        );
      }
      return relative(outDir, memberMarkdownPath(p.memberSlugs, outputDir, f))
        .split(sep)
        .join('/');
    });
  }
  const base = merge ? collectionBaseContent(p.entries, 'markdown', p.content) : p.content;
  await convertToMarkdown(rewriteImagePaths(prependLinksMarkdown(base, p.creatorLinks), p.relImageMap, p.docDir), outPath, p.exportDoc, mdFm, merge);
  recordSupportCommand('post', outPath, ['iteraciones', 'markdown', label, '-o', outPath]);
}

function interventionSectionRaw(lineLength = 0.5): string {
  const rule = `\\rule{${lineLength}\\textwidth}{0.4pt}`;
  return `\`\`\`{=latex}
\\RedeclareSectionCommand[style=chapter,beforeskip=2\\baselineskip,afterskip=0pt,afterindent=false]{chapter}
\\RedeclareSectionCommand[style=section,beforeskip=0pt,afterskip=1pt,afterindent=false]{section}
\\chapter{${rule}}
\\raisebox{12pt}{\\makebox[\\textwidth][c]{\\normalfont\\footnotesize Nombre}}
\\section{${rule}}
\\raisebox{12pt}{\\makebox[\\textwidth][c]{\\normalfont\\footnotesize Título}}
\\RedeclareSectionCommand[style=chapter,beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{chapter}
\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{section}
\`\`\``;
}

function buildCollectionEntryLatex(
  e: {
    creator: string[];
    title: string;
    subtitle: string | undefined;
    type: string | undefined;
    lineLength: number | undefined;
    pages: number | undefined;
    body: string;
  },
  isHeader: boolean,
): string[] {
  const parts: string[] = [];
  if (e.type === 'intervention') {
    parts.push(interventionSectionRaw(e.lineLength));
    parts.push('\\thispagestyle{empty}');
    parts.push(e.body.trim());
    if (e.pages && e.pages > 0) {
      parts.push('\\thispagestyle{empty}\n\\null\\newpage\n'.repeat(e.pages).trim());
    }
  } else {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : 'Anónima';
    const title = e.title || 'Sin título';
    parts.push(`\\chapter{${creator}}`);
    if (isHeader) parts.push('\\thispagestyle{empty}');
    if (e.subtitle) {
      parts.push(`\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=1\\baselineskip,afterindent=false]{section}`);
      parts.push(`\\section{${title}}`);
      parts.push(`\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{section}`);
      parts.push(`\\subsection{${e.subtitle}}`);
    } else {
      parts.push(`\\section{${title}}`);
    }
    parts.push(e.body.trim());
  }
  return parts;
}

function buildCollectionSectionsLatex(
  entries: {
    creator: string[];
    title: string;
    subtitle: string | undefined;
    type: string | undefined;
    lineLength: number | undefined;
    pages: number | undefined;
    body: string;
  }[],
  pageNumber?: string,
): string {
  const isHeader = pageNumber?.startsWith('header-') ?? false;
  const parts: string[] = [];
  for (const e of entries) {
    parts.push(...buildCollectionEntryLatex(e, isHeader));
  }
  return parts.join('\n\n');
}

/**
 * #2483 — fusión completa con los encabezados de cada miembro: es lo que sigue
 * recibiendo el EPUB (y `iteraciones merge --format epub`). La página HTML pasa
 * por `collectionCardsContent`, que enlaza en vez de fusionar.
 *
 * Las interventions se quedan fuera: son un recurso de imprenta y el EPUB es
 * un libro de lectura, no un impreso (las compone el PDF). El filtro vive en
 * `resolveCollectionContent`.
 */
function buildCollectionSectionsHtml(
  entries: {
    creator: string[];
    title: string;
    subtitle: string | undefined;
    type: string | undefined;
    lineLength: number | undefined;
    pages: number | undefined;
    body: string;
  }[],
): string {
  const parts: string[] = [];
  for (const e of entries) {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : 'Anónima';
    const title = e.title || 'Sin título';
    parts.push(`<h2>${creator}</h2>`);
    parts.push(`<h3>${title}</h3>`);
    if (e.subtitle) parts.push(`<h4>${e.subtitle}</h4>`);
    parts.push(e.body.trim());
  }
  return parts.join('\n\n');
}

/**
 * #2483 — href de cada miembro hacia su propio HTML, relativo a la página de la
 * collection. El slug es el del discovery (el mismo que nombra su salida); un
 * miembro sin slug no tiene HTML conocido y su tarjeta se queda sin enlace.
 */
export function memberHtmlHrefs(collectionPath: string, entries: CollectionEntry[], slugIndex: Map<string, DiscoveryEntry>): Map<string, string> {
  const dir = dirname(collectionPath);
  const hrefs = new Map<string, string>();
  for (const e of entries) {
    const slug = slugIndex.get(e.file)?.slug;
    if (slug === undefined) continue;
    const html = join(dirname(e.file), `${htmlSlugFor(e.file, slug)}.html`)
      .split(sep)
      .join('/');
    hrefs.set(e.file, relativeHref(dir, html));
  }
  return hrefs;
}

/**
 * #2485 — las interventions son un recurso de imprenta (una regla con el nombre
 * y el título, y sus páginas en blanco): solo entran al PDF y al markdown
 * exportado. Ni la página HTML ni el EPUB las llevan; el PDF las compone
 * `buildCollectionEntryLatex` con su propio `interventionSectionRaw`.
 */
function printableEntries<T extends { type: string | undefined }>(entries: T[]): T[] {
  return entries.filter((e) => e.type !== 'intervention');
}

/**
 * #2483 — la página HTML de una collection: una tarjeta con los datos de la
 * collection (creators, title y su body propio) y una tarjeta por miembro, con
 * su autor y título, su fragmento (primer párrafo o fenced div completo, a lo
 * más 100 palabras, con `...` si hubo corte) y un enlace a su HTML completo.
 * Todas van en el body, que la plantilla coloca al nivel del masonry
 * (`$if(collection)$`) y no dentro de la tarjeta de contenido.
 * El EPUB y el PDF siguen con la fusión completa: solo cambia HTML.
 *
 * `fm` es el frontmatter de la collection con los campos derivados que deja el
 * build (`creator`: la unión de los files). Lo pasan el build e
 * `iteraciones merge` con los mismos valores, para que su entrada sea
 * byte-idéntica.
 */
export function collectionCardsContent(
  entries: CollectionEntry[],
  memberHrefs: Map<string, string>,
  content: string,
  fm?: Record<string, unknown>,
): string {
  if (entries.length === 0 && fm === undefined) return content;
  const cards: string[] = [];
  if (fm !== undefined) cards.push(collectionDataCard(fm, splitFrontmatter(content).body));
  for (const e of printableEntries(entries)) cards.push(collectionCard(e, memberHrefs.get(e.file)));
  return cards.join('\n\n');
}

/**
 * #2483 — contenido que se escanea en busca de imágenes. En una collection su
 * body propio sale en la tarjeta de la página HTML, así que también entra en el
 * escaneo (los demás formatos siguen descartándolo).
 */
export function collectionScanContent(entries: CollectionEntry[], content: string): string {
  if (entries.length === 0) return content;
  const body = splitFrontmatter(content).body;
  const sections = collectionBaseContent(entries, 'latex', content);
  return body.trim() === '' ? sections : `${sections}\n\n${body}`;
}

/** #2483 — contenedor de cada tarjeta del masonry, el mismo de las demás. */
const MASONRY_WRAPPER = '<div class="break-inside-avoid pb-6">';

/**
 * #2483 — tipografía del texto de las tarjetas: `prose` más las reglas de
 * encabezados, citas y tablas de la tarjeta de contenido. Sin ellas, al salir
 * del `article.prose` el fragmento y el body propio quedarían sin formato.
 */
const CARD_TEXT_CLASSES =
  'prose prose-xl prose-accent dark:prose-invert max-w-none [&_blockquote]:border-accent-500/40 [&_.citation_a]:text-accent-950 dark:[&_.citation_a]:text-accent-50 [&_.citation_a]:underline [&_.citation_a]:underline-offset-4 [&_.citation_a]:decoration-accent-500/60 [&_.citation_a]:transition-colors [&_.citation_a]:duration-200 [&_.citation_a:hover]:decoration-accent-500 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-accent-500/10 [&_pre]:bg-stone-100 dark:[&_pre]:bg-stone-950/70 [&_h1:not([class])]:text-2xl [&_h1.unnumbered]:text-2xl [&_h2:not([class])]:text-xl [&_h3:not([class])]:text-xl [&_h3:not([class])]:text-accent-700 dark:[&_h3:not([class])]:text-accent-300 [&_h4:not([class])]:text-xl [&_h4:not([class])]:uppercase [&_h4:not([class])]:tracking-wide [&_h5:not([class])]:text-xl [&_h5:not([class])]:italic [&_h6:not([class])]:text-xl [&_h6:not([class])]:italic [&_h6:not([class])]:font-normal [&_table]:border-accent-500/10 [&_th]:border-accent-500/10 [&_td]:border-accent-500/10';

/**
 * #2483 — clases de la tarjeta de un miembro: la misma tarjeta redondeada que
 * las del resto del HTML. Van en `class="..."` (y no en `{.clase}`) porque
 * varias llevan `:` y `/`, que el atributo de un fenced div con punto no admite.
 */
const COLLECTION_CARD_CLASSES = `tarjeta-fragmento rounded-xl border border-accent-500/25 bg-stone-50/70 dark:bg-stone-900/60 p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 ${CARD_TEXT_CLASSES}`;

/** #2483 — marco de la tarjeta de la collection: el de la tarjeta de contenido. */
const DATA_CARD_CLASSES = `tarjeta-coleccion relative rounded-2xl border border-accent-500/30 bg-stone-50/90 dark:bg-stone-900/85 p-6 shadow-sm ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 outline outline-1 outline-offset-4 outline-accent-500/10 transition-colors duration-200 hover:border-accent-500/40 [overflow-wrap:anywhere] [&::before]:pointer-events-none [&::before]:absolute [&::before]:left-2 [&::before]:top-2 [&::before]:h-3 [&::before]:w-3 [&::before]:border-l [&::before]:border-t [&::before]:border-accent-500/40 [&::before]:content-[''] [&::after]:pointer-events-none [&::after]:absolute [&::after]:bottom-2 [&::after]:right-2 [&::after]:h-3 [&::after]:w-3 [&::after]:border-b [&::after]:border-r [&::after]:border-accent-500/40 [&::after]:content-[''] ${CARD_TEXT_CLASSES}`;

/** Ficha de la tarjeta de la collection: mismas clases que la de card-contenido.html. */
const DATA_PILL_CLASSES =
  'inline-block align-top rounded-full border border-accent-500/40 bg-accent-500/15 px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none mt-0 mb-12 text-accent-600 dark:text-accent-400';
const DATA_AUTHOR_CLASSES = 'mb-4 text-sm font-mono text-accent-950 dark:text-accent-50 [font-variant-caps:small-caps] tracking-widest';
const DATA_TITLE_CLASSES = 'mb-3 font-bold uppercase tracking-wide text-3xl text-accent-500';
const DATA_SUBTITLE_CLASSES = 'mb-3 text-base italic text-accent-950 dark:text-accent-50';
const DATA_DATE_CLASSES = 'text-sm font-mono text-accent-600 dark:text-accent-400';

/**
 * #2483 — la tarjeta con los datos de la collection: la unión de las creadoras
 * de sus files, su `collectionCreator`, el título, el subtítulo, la fecha y su
 * body propio (que hasta ahora no salía en ningún formato). El texto y el
 * `&` de las clases los escapa pandoc al convertir.
 */
function collectionDataCard(fm: Record<string, unknown>, body: string): string {
  const creators = fmStringList(fm.creator) ?? [];
  const editors = fmStringList(fm.collectionCreator) ?? [];
  const title = fmTrimmedString(fm.title);
  const subtitle = fmTrimmedString(fm.subtitle);
  const date = formatHumanDate(fmTrimmedString(fm.date));
  const intro = body.trim();
  // `:::::` (5 colones): el body propio es markdown libre y puede traer un div
  // de 4, que con la valla de la tarjeta la cerraría antes de tiempo.
  const card = [`::::: {class="${DATA_CARD_CLASSES}"}`, ''];
  card.push(`<h2 class="${DATA_PILL_CLASSES}">Colección</h2>`, '');
  card.push(`<div class="${intro === '' ? 'mb-0' : 'mb-24'}">`);
  if (creators.length > 0) card.push(`<p class="${DATA_AUTHOR_CLASSES}">${creators.join(', ')}</p>`);
  if (title !== undefined && title !== 'Sin título') card.push(`<h1 class="${DATA_TITLE_CLASSES}">${title}</h1>`);
  for (const editor of editors) card.push(`<p class="${DATA_AUTHOR_CLASSES}">${editor}</p>`);
  if (subtitle !== undefined) card.push(`<p class="${DATA_SUBTITLE_CLASSES}">${subtitle}</p>`);
  if (date !== undefined) card.push(`<p class="${DATA_DATE_CLASSES}">${date}</p>`);
  card.push('</div>');
  if (intro !== '') card.push('', intro);
  card.push('', ':::::');
  return [MASONRY_WRAPPER, '', ...card, '', '</div>'].join('\n');
}

function collectionCard(e: CollectionEntry, href: string | undefined): string {
  const creator = e.creator.length > 0 ? e.creator.join(', ') : 'Anónima';
  const title = e.title || 'Sin título';
  const fragment = extractFragment(e.body);
  // `::::` (4 colons) siempre: el fragmento puede ser él mismo un fenced div y
  // pandoc cierra el div externo con la primera valla de 4 que encuentre.
  const card = [`:::: {class="${COLLECTION_CARD_CLASSES}"}`, ''];
  card.push(`<h2>${creator}</h2>`, '', `<h3>${title}</h3>`);
  if (e.subtitle) card.push('', `<h4>${e.subtitle}</h4>`);
  if (fragment !== '') card.push('', fragment);
  if (href !== undefined) card.push('', `[Leer el texto completo →](${href})`);
  card.push('', '::::');
  return [MASONRY_WRAPPER, '', ...card, '', '</div>'].join('\n');
}

export function buildCollectionSectionsMarkdown(
  entries: {
    creator: string[];
    title: string;
    subtitle: string | undefined;
    type: string | undefined;
    lineLength: number | undefined;
    pages: number | undefined;
    body: string;
  }[],
): string {
  const parts: string[] = [];
  for (const e of entries) {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : 'Anónima';
    const title = e.title || 'Sin título';
    parts.push(`## ${creator}`);
    parts.push(`### ${title}`);
    if (e.subtitle) parts.push(`#### ${e.subtitle}`);
    parts.push(e.body.trim());
  }
  return parts.join('\n\n');
}

function resolveCollectionContent(
  collectionEntries: {
    creator: string[];
    title: string;
    subtitle: string | undefined;
    type: string | undefined;
    lineLength: number | undefined;
    pages: number | undefined;
    body: string;
  }[],
  format: 'latex' | 'html' | 'markdown',
  fallback: string,
  pageNumber?: string,
): string {
  if (collectionEntries.length === 0) return fallback;
  if (format === 'latex') return buildCollectionSectionsLatex(collectionEntries, pageNumber);
  if (format === 'html') {
    // el EPUB es el único que sigue fusionando: sin las interventions, que son
    // de imprenta. Si no queda ninguna, el libro lleva el body propio.
    const printable = printableEntries(collectionEntries);
    return printable.length === 0 ? fallback : buildCollectionSectionsHtml(printable);
  }
  return buildCollectionSectionsMarkdown(collectionEntries);
}

function buildOutputs(
  entry: DiscoveryEntry | undefined,
  slug: string,
  outSlug: string,
  dir: string,
  content: string,
  outputDir: string,
): DocumentOutputs {
  return {
    slug,
    outSlug,
    dir,
    fm: entry?.fm ?? {},
    content,
    outBase: (name: string): string => join(outputDir, dir === '.' ? '' : dir, name),
  };
}

export function getCreatorLinks(fm: Record<string, unknown>): { name: string; url: string }[] {
  const links = fm.links;
  if (!Array.isArray(links)) return [];
  return links.filter(
    (l: unknown): l is Record<string, unknown> =>
      typeof l === 'object' &&
      l !== null &&
      typeof (l as Record<string, unknown>).name === 'string' &&
      typeof (l as Record<string, unknown>).url === 'string',
  ) as { name: string; url: string }[];
}

function creatorLinksInlineMd(links: { name: string; url: string }[]): string {
  return links.map((l) => `**${l.name}**: ${l.url}`).join('\n');
}

export function prependLinksMarkdown(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const { yaml, body } = splitFrontmatter(content);
  const md = creatorLinksInlineMd(links);
  // #2436: al re-procesar el markdown exportado el bloque ya viaja inline al inicio del body.
  if (body.startsWith(md)) return content;
  const prefix = yaml !== undefined ? `---\n${yaml}\n---\n` : '';
  return `${prefix}${md}\n\n${body.trimEnd()}`;
}

function prependLinksLatex(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const { yaml, body } = splitFrontmatter(content);
  // #2436: el bloque ya está inline en el body re-procesado; no duplicarlo.
  if (body.startsWith(creatorLinksInlineMd(links))) return content;
  const latex = links.map((l) => `\\noindent \\textbf{${l.name}}: ${l.url}`).join('\n\n');
  const prefix = yaml !== undefined ? `---\n${yaml}\n---\n` : '';
  return `${prefix}${latex}\n\n\\vspace*{2\\baselineskip}\n\n\\noindent ${body.trimEnd()}`;
}

interface CreatorDoc {
  name: string;
  body: string;
  relativePath: string;
  links: { name: string; url: string }[];
}

async function collectCreatorNamesFromFiles(files: string[], cwd: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = await Bun.file(join(cwd, file)).text();
    } catch {
      continue;
    }
    const { yaml } = splitFrontmatter(text);
    if (!yaml) continue;
    try {
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
      extractCreatorNames(parsed.creator, names);
      extractCreatorNames(parsed.contributor, names);
    } catch {
      // skip unparseable files
    }
  }
  return names;
}

function extractCreatorNames(raw: unknown, target: Set<string>): void {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  for (const c of list) {
    if (typeof c === 'string' && c.trim()) target.add(c.trim());
  }
}

async function resolveSingleCreatorDoc(relativePath: string, cwd: string, collectionPath: string): Promise<CreatorDoc> {
  const filePath = join(cwd, relativePath);
  let text: string;
  try {
    text = await Bun.file(filePath).text();
  } catch {
    throw new BuildError(`collection "${collectionPath}": archivo de creator no encontrado: "${relativePath}"`);
  }
  const { yaml, body } = splitFrontmatter(text);
  let name = '';
  let links: { name: string; url: string }[] = [];
  if (yaml) {
    try {
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
      name = typeof parsed.name === 'string' && parsed.name ? parsed.name : typeof parsed.title === 'string' ? parsed.title : '';
      links = getCreatorLinks(parsed);
    } catch {
      // fall through
    }
  }
  if (!body.trim()) {
    throw new BuildError(`collection "${collectionPath}": creator "${name}" debe tener body (contenido después del frontmatter)`);
  }
  return { name, body, relativePath, links };
}

/** #2453 — el cierre de una collection seleccionada necesita sus creators. */
export async function resolveCollectionCreatorDocs(
  doc: BuildDocument,
  discoveryIndex: Map<string, DiscoveryEntry>,
  cwd: string,
  collectionFm: Record<string, unknown>,
): Promise<CreatorDoc[]> {
  const files = doc.frontmatter.files;
  if (!files || files.length === 0) return [];

  const creatorNames = await collectCreatorNamesFromFiles(files, cwd);
  extractCreatorNames(collectionFm.contributor, creatorNames);
  if (creatorNames.size === 0) return [];

  const result: CreatorDoc[] = [];
  for (const [relativePath, entry] of discoveryIndex.entries()) {
    if (entry.type !== 'creator') continue;
    const name = (entry.fm?.name ?? entry.fm?.title ?? '') as string;
    if (!name || !creatorNames.has(name)) continue;
    result.push(await resolveSingleCreatorDoc(relativePath, cwd, doc.relativePath));
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function buildCollectionAuthorsLatex(creatorDocs: CreatorDoc[], sourcePath: string, filters: ExportContext['filters']): Promise<string> {
  if (creatorDocs.length === 0) return '';
  const subsubsectionStyle =
    '\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{\\raggedright\\normalsize\\normalfont\\scshape}';
  const subsubsectionReset =
    '\\RedeclareSectionCommand[beforeskip=\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{\\normalsize\\normalfont\\bfseries}';
  const md = [`\\part{Autoras y colaboradoras}\n\n${subsubsectionStyle}`];
  for (const doc of creatorDocs) {
    md.push(`\\subsubsection{${doc.name}}`);
    if (doc.links.length > 0) {
      md.push(doc.links.map((l) => `\\noindent \\textbf{${l.name}}: ${l.url}`).join('\n\n'));
      md.push(`\\vspace*{\\baselineskip}\n\n\\noindent ${doc.body.trim()}`);
    } else {
      md.push(doc.body.trim());
    }
  }
  md.push(subsubsectionReset);
  const input = md.join('\n\n');
  const extraArgs = ['--shift-heading-level-by=2'];
  for (const f of [...filters.semantic, ...filters.latex]) {
    extraArgs.push('--lua-filter', f);
  }
  return execPandoc({
    input,
    sourcePath,
    from: MD_READER,
    to: 'latex',
    extraArgs,
    env: { ITERACIONES_MBOX_HELPERS: MBOX_HELPERS_FILTER },
  });
}

/** Fusión de la collection en el formato pedido; la usan el build y `iteraciones merge`. */
export function collectionBaseContent(
  collectionEntries: {
    creator: string[];
    title: string;
    subtitle: string | undefined;
    type: string | undefined;
    lineLength: number | undefined;
    pages: number | undefined;
    body: string;
  }[],
  format: 'latex' | 'html' | 'markdown',
  content: string,
  pageNumber?: string,
): string {
  return collectionEntries.length > 0 ? resolveCollectionContent(collectionEntries, format, content, pageNumber) : content;
}

/**
 * #2445 — la entrada de pandoc de una collection vive en
 * `.iteraciones/collections/<slug>.<fmt>.md`, byte-idéntica a su stdin, y se
 * registra en la fase de recursos del build.sh. Los documentos individuales
 * siguen viajando por .iteraciones/script/in-NNNN.md.
 */
function collectionPandocInput(doc: BuildDocument, cwd: string, outSlug: string, format: 'latex' | 'html' | 'epub'): string | undefined {
  if (doc.frontmatter.type !== 'collection') return undefined;
  const path = join(cwd, '.iteraciones', 'collections', `${outSlug}.${format}.md`);
  recordSupportCommand('resources', path, ['iteraciones', 'merge', doc.relativePath, '--format', format, '-o', path]);
  return path;
}

async function emitCollectionFormats(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: CollectionEntry[],
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan } = renderCtx;
  const { activeFormats } = plan;
  const content = outputs.content;
  const { formatCfg } = renderCtx;

  // #2435/#2450: las imágenes se preprocesan UNA vez hacia
  // <outputDir>/<nivel>/assets/images con nombre `<slug>-<base>` (un único
  // fichero por imagen, sin que se pisen documentos del nivel) y todos los
  // formatos las referencian como ./assets/images/<nombre>, idéntico en todos
  // los niveles. La fusión latex contiene las mismas imágenes que las variantes
  // html/markdown (los cuerpos son idénticos).
  const images = await preprocessDocumentImages(
    collectionScanContent(collectionEntries, content),
    doc,
    mergeConfigImages(outputs.fm, formatCfg?.pdf, ctx.siteConfig, ctx.cwd),
    renderCtx.pageDimensions ?? detectPageSize([]),
    renderCtx.cropActive,
    renderCtx.pdfxActive,
    outputs.outBase(ASSETS_IMAGES_DIR),
    outputs.outSlug,
  );
  const docDir = dirname(doc.filePath);
  const relImageMap = new Map(
    [...images.imageMap].filter(([src, dst]) => dst !== src).map(([src, dst]): [string, string] => [src, `./${ASSETS_IMAGES_DIR}/${basename(dst)}`]),
  );
  // #2441: el fm de los exports (html/markdown) debe apuntar a assets como el
  // body; outputs.fm no pasa por rewriteImagePaths y pisaba el contenido.
  const fmAssets = rewriteFmImagePaths(outputs.fm, relImageMap, docDir);

  const creatorLinks = doc.frontmatter.type === 'creator' ? getCreatorLinks(outputs.fm) : [];
  const isCollection = doc.frontmatter.type === 'collection';

  if ((activeFormats.latex || activeFormats.pdf) && formatWorkSets.latexPaths.has(doc.relativePath)) {
    const pageNumber = (outputs.fm.pageNumber ?? formatCfg?.pdf?.pageNumber ?? ctx.siteConfig.pageNumber) as string | undefined;
    const base = collectionBaseContent(collectionEntries, 'latex', content, pageNumber);
    const creatorDocs = isCollection ? await resolveCollectionCreatorDocs(doc, discoveryIndex, ctx.cwd, outputs.fm) : [];
    const authorsBlock = await buildCollectionAuthorsLatex(creatorDocs, doc.filePath, exportCtx.filters);
    await emitLatexAndQueuePdf(
      doc,
      { ...outputs, content: prependLinksLatex(base, creatorLinks) },
      renderCtx,
      exportCtx,
      formatWorkSets,
      images,
      authorsBlock,
    );
  }

  const exportDoc = assembleExportDocument(doc, renderCtx.lang, exportCtx.globalBibliography, exportCtx.globalCsl, ctx.siteConfig.toc);

  if (activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath) && docProducesFormat(doc.frontmatter.type, 'html')) {
    // #2483: HTML deja de fusionar los miembros: los datos de la collection van
    // en su propia tarjeta y cada file es una tarjeta con su fragmento y un
    // enlace a su propio HTML, todas al nivel del masonry. El EPUB, más abajo,
    // sigue con la fusión completa.
    const collectionFm = doc.frontmatter.type === 'collection' ? outputs.fm : undefined;
    const base = collectionCardsContent(
      collectionEntries,
      memberHtmlHrefs(doc.relativePath, collectionEntries, discoveryIndex),
      content,
      collectionFm,
    );
    // #2460: las rutas no se reescriben sobre el texto que va a pandoc; el
    // filtro 04-image-paths las reescribe sobre el AST.
    const imagePaths = await writeImagePaths(doc, ctx.cwd, 'html', images.imageMap, docDir, true);
    await emitHtmlPage(doc, { ...outputs, content: prependLinksMarkdown(base, creatorLinks) }, renderCtx, exportCtx, discoveryIndex, imagePaths);
  }

  if (activeFormats.epub && formatWorkSets.epubPaths.has(doc.relativePath) && docProducesFormat(doc.frontmatter.type, 'epub')) {
    // #2483: el EPUB es un libro: sigue recibiendo la fusión completa, no las
    // tarjetas de HTML (decisión del issue).
    const base = collectionBaseContent(collectionEntries, 'html', content);
    const imagePaths = await writeImagePaths(doc, ctx.cwd, 'epub', images.imageMap, docDir, false);
    await convertToEpub(
      // EPUB se arma con rutas absolutas: pandoc resuelve los medios contra el
      // cwd del proceso (entrada por stdin, sin --resource-path). El mapa
      // absoluto lo aplica 04-image-paths sobre el AST (#2460).
      prependLinksMarkdown(base, creatorLinks),
      outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('epub')}`),
      exportDoc,
      exportCtx.filters,
      ctx.siteConfig.toc,
      outputs.fm,
      collectionPandocInput(doc, ctx.cwd, outputs.outSlug, 'epub'),
      imagePaths,
    );
  }

  await emitCollectionMarkdown(
    doc,
    outputs,
    collectionEntries,
    renderCtx,
    exportDoc,
    formatWorkSets,
    creatorLinks,
    {
      relImageMap,
      docDir,
      fmAssets,
    },
    discoveryIndex,
  );
}

/**
 * #2452: export markdown de una collection. Con `format.markdown.merge`
 * (mergeOut) emite el contenido fusionado con type: file; sin él, el .md es
 * reprocesable: conserva type: collection, `files[]` reescrito hacia el `.md`
 * standalone de cada miembro (nombre-nuevo, escrito por el propio miembro) y
 * el body original de la collection. Todas las collections emiten markdown,
 * igual que cualquier otro type.
 */
async function emitCollectionMarkdown(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: CollectionEntry[],
  renderCtx: RenderContext,
  exportDoc: ExportDocument,
  formatWorkSets: FormatWorkSets,
  creatorLinks: { name: string; url: string }[],
  assets: { relImageMap: Map<string, string>; docDir: string; fmAssets: Record<string, unknown> },
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan, formatCfg } = renderCtx;
  if (!plan.activeFormats.markdown || !formatWorkSets.mdPaths.has(doc.relativePath)) return;

  const { relImageMap, docDir, fmAssets } = assets;
  const outPath = outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('markdown')}`);
  const isCollection = doc.frontmatter.type === 'collection';
  const rootFiles = isCollection ? (doc.frontmatter.files ?? []) : undefined;

  await writeDistMarkdown({
    label: doc.relativePath,
    content: outputs.content,
    outPath,
    outputDir: ctx.outputDir,
    fm: fmAssets,
    exportDoc,
    relImageMap,
    docDir,
    creatorLinks,
    rootFiles,
    memberSlugs: rootFiles === undefined ? undefined : memberSlugMap(rootFiles, discoveryIndex),
    merge: isCollection && formatCfg?.markdown?.merge === true,
    entries: collectionEntries,
  });
}

export async function processDocumentFormats(
  doc: BuildDocument,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx } = renderCtx;

  const content = await readMarkdownOrWarn(doc);

  const entry = discoveryIndex.get(doc.relativePath);
  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const outSlug = htmlSlugFor(doc.relativePath, slug);
  const dir = dirname(doc.relativePath);

  const isCollection = doc.frontmatter.type === 'collection';
  if (isCollection && entry?.aggregatedCreator) {
    doc.frontmatter.creator = entry.aggregatedCreator;
    entry.fm = { ...entry.fm, creator: entry.aggregatedCreator };
  }
  const collectionEntries = isCollection ? await readCollectionFiles(doc, ctx.cwd) : [];
  if (isCollection && collectionEntries.length === 0) {
    logWarning(`"${doc.relativePath}": collection sin contenido en files; se omite del build`, 'build');
    return;
  }
  // Las interventions son de imprenta: no salen en la página HTML ni en el
  // EPUB. Si no queda ningún archivo que sí salga, la collection no tiene nada
  // que publicar en esos dos formatos.
  if (isCollection && printableEntries(collectionEntries).length === 0) {
    throw new BuildError(
      `"${doc.relativePath}": todos los archivos de files[] son "type: intervention"; una collection necesita al menos un archivo de otro tipo (las interventions solo salen en el PDF y en el markdown exportado)`,
    );
  }

  const outputs = buildOutputs(entry, slug, outSlug, dir, content, ctx.outputDir);

  await emitCollectionFormats(doc, outputs, collectionEntries, renderCtx, exportCtx, formatWorkSets, discoveryIndex);
}
