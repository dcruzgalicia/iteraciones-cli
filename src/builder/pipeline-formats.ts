import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, resolveBooleanField, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { isScriptCapture, recordSupportCommand, resolveScriptStdout } from '../lib/script-recorder.js';
import { computeSlug, htmlSlugFor, parseAuthors } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import type { ExportDocument } from './export/types.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import { rewriteFmImagePaths, rewriteImagePaths } from './image-processor.js';
import {
  buildTexDistribution,
  copyDistAssets,
  type ImagePreprocessResult,
  insertAuthorsBlock,
  localizeDistAssets,
  markdownToLatex,
  mergeConfigImages,
  preprocessDocumentImages,
  rewriteTexForDist,
} from './latex-composer.js';
import { detectPageSize } from './latex-preamble.js';
import { ASSETS_CSS_FILE, ASSETS_IMAGES_DIR, primaryOutputExtension } from './output-layout.js';
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

  const { tex: fullTex, processedImages } = await markdownToLatex(outputs.content, doc, {
    filters: exportCtx.filters,
    bibFiles: exportCtx.bibFiles,
    inputTarget: collectionPandocInput(doc, ctx.cwd, outSlug, 'latex'),
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
  const texWithAuthors = insertAuthorsBlock(fullTex, authorsBlock);
  const texWithXmp = xmp === undefined ? texWithAuthors : injectXmpMetadataIntoLatex(texWithAuthors, xmp);

  if (latexOn) {
    const texDir = dirname(texDistPath);
    const distribution = buildTexDistribution(processedImages);
    // #2450: el preproceso ya escribió la imagen en <nivel>/assets/images, así
    // que la copia que antes vivía junto al .tex desaparece: el .tex apunta al
    // mismo fichero que html y markdown (la copia de distribution es no-op, se
    // queda por si algún día difieren). Lo único que hay que traer es lo que el
    // .tex cite bajo la raíz del proyecto: el QR del caché.
    const { tex: localizedTex, copies: rootCopies } = await localizeDistAssets(rewriteTexForDist(texWithXmp, distribution), {
      texDir,
      projectRoot: ctx.cwd,
      distRoot: ctx.outputDir,
      bundle: ctx.siteConfig.bundle === true,
    });
    await copyDistAssets(texDir, [...[...distribution].map(([src, rel]) => ({ src, rel })), ...rootCopies]);
    const distTex = localizedTex;
    // #2445: el .sh no puede recomputar autores/XMP/distribución, así que el
    // build se los deja escritos en un manifiesto que `iteraciones post latex` lee.
    let post: string[] | undefined;
    if (isScriptCapture()) {
      const manifest = join(ctx.cwd, '.iteraciones', 'post', `${outSlug}.json`);
      await writeOutput(
        manifest,
        `${JSON.stringify(
          {
            authorsBlock,
            xmp,
            distribution: Object.fromEntries(distribution),
            projectRoot: ctx.cwd,
            distRoot: ctx.outputDir,
            bundle: ctx.siteConfig.bundle === true,
          },
          null,
          2,
        )}\n`,
      );
      post = ['iteraciones', 'post', 'latex', '--post', manifest, '-o', texDistPath];
    }
    resolveScriptStdout(fullTex, texDistPath, distTex, post);
    await writeOutput(texDistPath, distTex);
  }

  if (pdfOn) {
    const texPath = join(exportCtx.pdfWorkDir, dir, `${outSlug}${primaryOutputExtension('latex')}`);
    await writeOutput(texPath, texWithXmp);
    sets.pdfJobs.push({
      dir,
      slug: outSlug,
      relativePath: doc.relativePath,
      texPath,
      pdfDest: outBase(`${outSlug}${primaryOutputExtension('pdf')}`),
      cover: resolveBooleanField(fm, formatCfg?.pdf, ctx.siteConfig, 'coverImage') === true,
    });
  }
}

async function emitHtmlPage(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  discoveryIndex: Map<string, DiscoveryEntry>,
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
    if (parsed.body.trim()) entries.push(parsed);
  }
  return entries;
}

async function readCollectionFiles(doc: BuildDocument, cwd: string): Promise<CollectionEntry[]> {
  const files = doc.frontmatter.files;
  if (!files || files.length === 0) return [];
  return readCollectionEntries(files, doc.relativePath, [cwd, join(cwd, dirname(doc.relativePath))]);
}

/**
 * #2437: con `format.markdown.merge: false` cada miembro de la collection se
 * copia a dist para que `iteraciones merge` y el re-proceso lean de ahí.
 * Las imágenes se reescriben con el mismo mapa del cuerpo fusionado: las
 * rutas ./assets/images son válidas desde cualquier .md del nivel.
 */
export async function emitCollectionMemberCopies(
  label: string,
  cwd: string,
  outputDir: string,
  files: string[],
  relImageMap: Map<string, string>,
  docDir: string,
  skipPath: string,
): Promise<void> {
  const root = resolve(outputDir);
  for (const file of files) {
    const dest = resolve(root, normalize(file));
    if (dest === skipPath || (dest !== root && !dest.startsWith(`${root}${sep}`))) {
      logWarning(`"${label}": files contiene "${file}", que apunta fuera de la salida; copia de miembro omitida`, 'build');
      continue;
    }
    const text = await Bun.file(join(cwd, file)).text();
    await Bun.write(dest, rewriteImagePaths(text, relImageMap, docDir));
  }
}

/**
 * #2445 — el markdown de dist (#2436), con el composit compartido entre
 * `emitCollectionMarkdown` y `iteraciones markdown`: escribe el .md final y,
 * si la collection no se fusiona, las copias de sus miembros. El build graba
 * aquí el argv que el .sh vuelve a ejecutar.
 */
export async function writeDistMarkdown(p: {
  cwd: string;
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
    mdFm.files = rootFiles.map((f) =>
      relative(outDir, join(outputDir, normalize(f)))
        .split(sep)
        .join('/'),
    );
  }
  const base = merge ? collectionBaseContent(p.entries, 'markdown', p.content) : p.content;
  await convertToMarkdown(rewriteImagePaths(prependLinksMarkdown(base, p.creatorLinks), p.relImageMap, p.docDir), outPath, p.exportDoc, mdFm, merge);
  if (rootFiles !== undefined && !merge) {
    await emitCollectionMemberCopies(label, p.cwd, outputDir, rootFiles, p.relImageMap, p.docDir, outPath);
  }
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
  if (format === 'html') return buildCollectionSectionsHtml(collectionEntries);
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

async function resolveCollectionCreatorDocs(
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
    collectionBaseContent(collectionEntries, 'latex', content),
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

  if (activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath) && doc.frontmatter.type !== 'intervention') {
    const base = collectionBaseContent(collectionEntries, 'html', content);
    const htmlContent = rewriteImagePaths(prependLinksMarkdown(base, creatorLinks), relImageMap, docDir);
    await emitHtmlPage(doc, { ...outputs, content: htmlContent }, renderCtx, exportCtx, discoveryIndex);
  }

  if (activeFormats.epub && formatWorkSets.epubPaths.has(doc.relativePath) && doc.frontmatter.type !== 'intervention') {
    const base = collectionBaseContent(collectionEntries, 'html', content);
    await convertToEpub(
      // EPUB se arma con rutas absolutas: pandoc resuelve los medios contra el
      // cwd del proceso (entrada por stdin, sin --resource-path).
      rewriteImagePaths(prependLinksMarkdown(base, creatorLinks), images.imageMap, docDir),
      outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('epub')}`),
      exportDoc,
      exportCtx.filters,
      ctx.siteConfig.toc,
      outputs.fm,
      collectionPandocInput(doc, ctx.cwd, outputs.outSlug, 'epub'),
    );
  }

  await emitCollectionMarkdown(doc, outputs, collectionEntries, renderCtx, exportDoc, formatWorkSets, creatorLinks, {
    relImageMap,
    docDir,
    fmAssets,
  });
}

/**
 * #2437: export markdown de una collection. Con `format.markdown.merge`
 * (mergeOut) emite el contenido fusionado con type: file; sin él, el .md es
 * reprocesable: conserva type: collection, files[] reescrito a las copias de
 * los miembros (emitidas aquí) y el body original de la collection.
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
): Promise<void> {
  const { ctx, plan, formatCfg } = renderCtx;
  if (!plan.activeFormats.markdown || !formatWorkSets.mdPaths.has(doc.relativePath) || doc.frontmatter.type === 'intervention') return;

  const { relImageMap, docDir, fmAssets } = assets;
  const outPath = outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('markdown')}`);
  const isCollection = doc.frontmatter.type === 'collection';

  await writeDistMarkdown({
    cwd: ctx.cwd,
    label: doc.relativePath,
    content: outputs.content,
    outPath,
    outputDir: ctx.outputDir,
    fm: fmAssets,
    exportDoc,
    relImageMap,
    docDir,
    creatorLinks,
    rootFiles: isCollection ? (doc.frontmatter.files ?? []) : undefined,
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
  if (content === null) return;

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

  const outputs = buildOutputs(entry, slug, outSlug, dir, content, ctx.outputDir);

  await emitCollectionFormats(doc, outputs, collectionEntries, renderCtx, exportCtx, formatWorkSets, discoveryIndex);
}
