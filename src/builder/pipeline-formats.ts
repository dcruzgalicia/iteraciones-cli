import { basename, dirname, join } from 'node:path';

import { formatHumanDate } from '../lib/date.js';
import { fmStringList, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { htmlSlugFor } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import { buildTexDistribution, markdownToLatex, rewriteTexForDist } from './latex-composer.js';
import { primaryOutputExtension } from './output-layout.js';
import { formatLinksFor, readMarkdownOrWarn, relativeHref, writeOutput } from './pipeline-io.js';
import type { ExportContext, FormatWorkSets, RenderContext } from './pipeline-setup.js';
import { htmlPageFromMarkdown } from './render.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';
import type { PdfXmpMetadata } from './xmpdata.js';
import { injectXmpMetadataIntoLatex } from './xmpdata.js';

/**
 * Procesamiento por documento del pool 1 (#2176): para cada documento, el
 * markdown original se lee una sola vez y cada formato activo se genera con
 * una invocación directa de pandoc (markdown → latex/html5/epub3/markdown).
 * Sin AST intermedio; la frontera con el pool PDF es explícita (jobs encolados
 * que pdf-pool.ts consume en paralelo).
 */

/** Artefactos de salida compartidos por todos los formatos de un documento. */
interface DocumentOutputs {
  /** Slug base del documento (para títulos). */
  slug: string;
  /** Slug efectivo de salida: index.md → index.* aplica a todo formato (#2087). */
  outSlug: string;
  dir: string;
  fm: Record<string, unknown>;
  content: string;
  outBase(name: string): string;
}

/**
 * Metadatos XMP/Info del documento desde el frontmatter crudo y el lang efectivo
 * (el que usa el pipeline para el PDF, no el lang del frontmatter). Solo los
 * campos presentes se emiten en el .tex (issue #1970).
 */
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
 * Genera el .tex completo y publica según formatos activos: con LaTeX escribe
 * el tex distribuido (portable, ADR #2084); si PDF está activo ENCOLA la
 * compilación en la cola del pool 2.
 *
 * Esta función es la frontera explícita entre pools: aquí SOLO se produce el
 * job de PDF — nada de latexmk ocurre en este hilo, lo consume pdf-pool.ts
 * arrancado en paralelo por documentPipeline.
 */
async function emitLatexAndQueuePdf(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  sets: FormatWorkSets,
): Promise<void> {
  const { ctx, lang, warnedLangs, formatCfg, plan } = renderCtx;
  const latexOn = plan.activeFormats.latex;
  const pdfOn = plan.activeFormats.pdf;
  const { dir, outBase, outSlug, fm } = outputs;
  const texDistPath = outBase(`${outSlug}${primaryOutputExtension('latex')}`);

  // .tex completo (preámbulo + cuerpo) en UNA invocación markdown → latex: el
  // artefacto de dist/ es el bundle portable (si latexOn) y la copia de
  // compilación vive en el área de trabajo del pool PDF (si pdfOn) (#2156).
  const { tex: fullTex, processedImages } = await markdownToLatex(outputs.content, doc, {
    filters: exportCtx.filters,
    bibFiles: exportCtx.bibFiles,
    templatePath: exportCtx.latexTemplatePath,
    fm,
    siteConfig: ctx.siteConfig,
    biblatexAvailable: exportCtx.biblatexAvailable,
    warnedLangs,
    pageDimensions: renderCtx.pageDimensions,
    cropActive: renderCtx.cropActive,
    pdfxActive: renderCtx.pdfxActive,
  });
  // Con 99-pdfx activo se inyectan los metadatos XMP e Info en el .tex
  // (filecontents + \pdfinfo): el tex de dist/ queda autocontenido (issue #1970).
  const texWithXmp = renderCtx.pdfxActive ? injectXmpMetadataIntoLatex(fullTex, xmpMetadataFor(fm, lang, formatCfg?.pdf, ctx.siteConfig)) : fullTex;

  if (latexOn) {
    // Distribución portátil (ADR #2084): las copias viajan JUNTO al .tex de
    // dist/ con nombre namespaced, y el .tex distribuido referencia esos
    // filenames — compila fuera del árbol del proyecto. Ese bundle es un
    // artefacto de DISTRIBUCIÓN, no de compilación: el pool PDF nunca lo usa.
    const distribution = buildTexDistribution(processedImages, outSlug);
    // Copias concurrentes (#2093): la fase corre dentro del pool del pipeline;
    // serializarlas domina la latencia de documentos ricos en imágenes.
    await Promise.all(
      [...distribution].map(async ([absSrc, fileName]) => {
        if (await Bun.file(absSrc).exists()) await Bun.write(outBase(fileName), Bun.file(absSrc));
      }),
    );
    await writeOutput(texDistPath, rewriteTexForDist(texWithXmp, distribution));
  }

  if (pdfOn) {
    // El pool compila SIEMPRE desde el área de trabajo con rutas absolutas:
    // latexmk corre con cwd/-outdir en el slot aislado (#1967), así que un tex
    // con nombres relativos no resolvería los gráficos ahí (#2156 — antes se
    // le entregaba el tex reescrito de dist y fallaba pdftex.def).
    const texPath = join(exportCtx.pdfWorkDir, dir, `${outSlug}${primaryOutputExtension('latex')}`);
    await writeOutput(texPath, texWithXmp);
    // ── FRONTERA pool 1 → pool 2: desde aquí ejecuta pdf-pool.ts ──
    sets.pdfJobs.push({
      dir,
      slug: outSlug,
      relativePath: doc.relativePath,
      texPath,
      pdfDest: outBase(`${outSlug}${primaryOutputExtension('pdf')}`),
    });
  }
}

/** Renderiza y publica la página HTML del documento. */
async function emitHtmlPage(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan, formatCfg, lang, logoInline } = renderCtx;
  const htmlConfig = formatCfg?.html;
  const { dir, outBase, outSlug, slug, fm, content } = outputs;
  const cwd = ctx.cwd;

  // Enlaces a los formatos generados (PDF/LaTeX/EPUB/Markdown); el HTML es la
  // página actual y no se enlaza a sí mismo. Solo formatos activos.
  const formats = formatLinksFor(plan, dir, outSlug);
  // La tarjeta identidad enlaza al home solo si existe index.html en la
  // raíz de salida (index.md en la raíz del proyecto); sin él, la tarjeta
  // se renderiza sin enlace (template $if(home-href)$). El href apunta
  // explícitamente a index.html (./index.html, ../index.html, ...):
  // determinista con file:// y en servidores sin directory index.
  const hasHomePage = discoveryIndex.has('index.md');
  const html = await htmlPageFromMarkdown(content, doc, {
    cwd,
    vars: {
      title: doc.frontmatter.title || slug,
      siteTitle: htmlConfig?.site?.title ?? 'iteraciones',
      tagline: htmlConfig?.site?.description ?? 'escribir, compartir, re-existir',
      lang,
      theme: htmlConfig?.site?.theme,
      accent: htmlConfig?.site?.color,
      css: ctx.needsCss ? relativeHref(dir, 'css/styles.css') : undefined,
      authorMeta: doc.frontmatter.creator.join(', '),
      logoInline,
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
  });
  await writeOutput(outBase(`${outSlug}${primaryOutputExtension('html')}`), html);
}

/** Procesa todos los formatos de un documento: markdown → tex/HTML/EPUB/MD → cola PDF. */
export async function processDocumentFormats(
  doc: BuildDocument,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan } = renderCtx;
  const { activeFormats } = plan;

  const content = await readMarkdownOrWarn(doc);
  if (content === null) return;

  const entry = discoveryIndex.get(doc.relativePath);
  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  // Nombre de salida coherente en todos los formatos: index.md → index.* (el
  // caso especial de htmlSlugFor aplica a todo el documento, no solo al HTML;
  // antes, index.md generaba index.html pero inicio.pdf/tex/epub/md).
  const outSlug = htmlSlugFor(doc.relativePath, slug);
  const dir = dirname(doc.relativePath);
  const outputs: DocumentOutputs = {
    slug,
    outSlug,
    dir,
    fm: entry?.fm ?? {},
    content,
    outBase: (name: string): string => join(ctx.outputDir, dir === '.' ? '' : dir, name),
  };

  // Frontera explícita pool 1 → pool 2: genera los .tex de este build y
  // ENCOLA los trabajos PDF; latexmk corre en pdf-pool.ts (pool 2).
  if ((activeFormats.latex || activeFormats.pdf) && formatWorkSets.latexPaths.has(doc.relativePath)) {
    await emitLatexAndQueuePdf(doc, outputs, renderCtx, exportCtx, formatWorkSets);
  }

  const exportDoc = assembleExportDocument(doc, renderCtx.lang, exportCtx.globalBibliography, exportCtx.globalCsl, ctx.siteConfig.toc);

  if (activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath)) {
    await emitHtmlPage(doc, outputs, renderCtx, exportCtx, discoveryIndex);
  }

  // EPUB y Markdown desde el markdown original, directo a dist/
  if (activeFormats.epub && formatWorkSets.epubPaths.has(doc.relativePath)) {
    await convertToEpub(
      content,
      outputs.outBase(`${outSlug}${primaryOutputExtension('epub')}`),
      exportDoc,
      exportCtx.filters,
      ctx.siteConfig.toc,
      outputs.fm,
    );
  }
  if (activeFormats.markdown && formatWorkSets.mdPaths.has(doc.relativePath)) {
    await convertToMarkdown(
      content,
      outputs.outBase(`${outSlug}${primaryOutputExtension('markdown')}`),
      exportDoc,
      exportCtx.filters,
      ctx.cwd,
      outputs.fm,
    );
  }
}
