import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ProgressTracker } from '../cli/progress.js';
import { DEFAULT_SITE_CONFIG, type FormatConfig } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import type { BuildMetadata, WorkSets } from './build-planner.js';
import { htmlSlugFor } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import { composeFullTex } from './latex-preamble.js';
import { createPdfConsumer, type PdfJob } from './pdf-pool.js';
import { loadPreambleFilters } from './preamble-loader.js';
import { loadFilterGroups, markdownToAst, renderHtmlPageFromAst, resolveUserLuaFilters, texBodyFromAst } from './render.js';
import { readAstFromCache, resolveBibOptions, writeCachedArtifacts } from './state.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

/** Job de compilación PDF encolado por el pool de formatos. */

/**
 * Ruta relativa desde el directorio de un documento (en dist/files/) hasta
 * un archivo en la raíz de salida. Permite abrir el HTML con file:// sin
 * servidor: los enlaces son relativos al documento, no absolutos.
 * Ej: dir='.' → './css/styles.css'; dir='posts' → './../css/styles.css'.
 */
function relativeHref(dir: string, file: string): string {
  const depth = dir === '.' ? 0 : dir.split('/').length;
  return `./${'../'.repeat(depth)}${file}`;
}

/** Contexto compartido por el pool de formatos ligeros. */
/**
 * Ejecuta el pipeline por documento (fases 2-6 fusionadas):
 *
 * Pool 1 (formatos ligeros, concurrencia general): para cada documento,
 * obtiene el AST (fresco desde markdown o del caché en disco), genera el
 * cuerpo LaTeX, HTML, EPUB, Markdown y el .tex completo, persiste el AST en
 * disco (caché incremental) y encola la compilación PDF.
 *
 * Pool 2 (PDF, concurrencia CPU − 1): consume la cola de jobs producida por
 * el pool 1 mientras este sigue trabajando, solapando latexmk con pandoc.
 *
 * El AST vive únicamente en la memoria del worker que procesa el documento:
 * la memoria pico es O(concurrencia), no O(n).
 *
 * Retorna los relativePath procesados y el total de documentos.
 */
export async function runDocumentPipeline(
  progress: ProgressTracker,
  ctx: BuildContext,
  plan: BuildMetadata,
  work: WorkSets,
  formatCfg: FormatConfig | undefined,
  formatsDir: string,
  discoveryIndex: Map<string, DiscoveryEntry>,
  options: { noExport?: boolean } = {},
): Promise<{ processed: Set<string> }> {
  const { pdfOn, latexOn, htmlOn, epubOn, mdOn } = plan;
  const noExport = options.noExport === true;
  const siteConfig = ctx.siteConfig;
  const userFilters = await resolveUserLuaFilters(ctx.cwd, siteConfig);
  // La bibliografía se resuelve una sola vez por build y se comparte con todos
  // los documentos (antes cada texBodyFromAst re-ejecutaba el glob completo).
  const bib = await resolveBibOptions(ctx.cwd, siteConfig);
  const bibOptions = bib.bibOptions;
  const bibFiles = bib.bibFiles;
  const globalBibliography = bibOptions?.bibliography;
  // El default vive en DEFAULT_SITE_CONFIG (es-MX): el fallback local no debe
  // divergir de la configuración (un lang distinto emite --metadata distinto).
  const lang = siteConfig.lang ?? DEFAULT_SITE_CONFIG.lang;
  const htmlConfig = formatCfg?.html;
  const logoInline = await loadLogoInline(ctx.cwd, htmlConfig?.logo?.trim());

  // Unión de todos los documentos con trabajo este build
  const workDocs = new Map<string, BuildDocument>();
  for (const doc of [...work.renderDocs, ...work.exportSets.html, ...work.exportSets.epub, ...work.exportSets.markdown, ...work.exportSets.pdf]) {
    workDocs.set(doc.relativePath, doc);
  }
  const workDocList = [...workDocs.values()];

  // Pre-crear directorios de caché de biber (uno por slot de concurrencia de PDF).
  const compilePdf = pdfOn && !noExport;
  const maxSlots = compilePdf ? Math.max(1, ctx.concurrency) : 0;
  const biberBase = join(ctx.cwd, '.iteraciones', 'biber');
  if (compilePdf && maxSlots > 0) {
    await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
  }

  // ── Pool 2 (PDF): consumidor de la cola, arranca en paralelo con el pool 1 ──
  const pdfConsumer = createPdfConsumer(formatsDir, biberBase, maxSlots, progress);
  if (compilePdf && work.exportSets.pdf.length > 0) {
    // Los workers arrancan antes del pool 1: latexmk se solapa con pandoc.
    pdfConsumer.start();
  }

  // ── Pool 1 (formatos ligeros) ──
  const processed = new Set<string>();
  const renderDocPaths = new Set(work.renderDocs.map((d) => d.relativePath));
  const htmlPaths = new Set(work.exportSets.html.map((d) => d.relativePath));
  const epubPaths = new Set(work.exportSets.epub.map((d) => d.relativePath));
  const mdPaths = new Set(work.exportSets.markdown.map((d) => d.relativePath));
  const pdfPaths = new Set(work.exportSets.pdf.map((d) => d.relativePath));
  const filters = await loadFilterGroups(siteConfig, siteConfig.disabledFilters, ctx.cwd);
  // Los preamble filters (.tex) se cargan una sola vez por build: no dependen
  // del documento (antes se releían los 26 archivos por cada documento).
  const preambleFilters = plan.generateLatex ? await loadPreambleFilters(siteConfig.format?.pdf?.disabledPreambleFilters, ctx.cwd) : undefined;

  progress.startLightFormats();
  try {
    await mapWithConcurrency(workDocList, ctx.concurrency, async (doc) => {
      await processDocumentFormats(
        doc,
        {
          ctx,
          plan,
          formatCfg,
          formatsDir,
          userFilters,
          globalBibliography,
          lang,
          logoInline,
          filters,
          bibOptions,
          bibFiles,
          preambleFilters,
          renderDocPaths,
          htmlPaths,
          epubPaths,
          mdPaths,
          pdfPaths,
          pdfJobs: pdfConsumer.pdfJobs,
          noExport,
        },
        discoveryIndex,
      );
      processed.add(doc.relativePath);
      progress.reportFile({ relativePath: doc.relativePath, phase: 'render' });
    });
    pdfConsumer.markProducerDone();
  } catch (err) {
    // Fallo del pool 1: cancelar la cola PDF para que los workers salgan sin
    // compilar lo pendiente y el error se propague sin colgar el proceso.
    pdfConsumer.cancel();
    throw err;
  }

  // Completar las subtareas de los formatos ligeros activos y la fase render:
  // su trabajo ocurre dentro del pool 1, así que el tracker avanza al grupo
  // 'Generando formatos' mientras los PDFs siguen compilando en el pool 2
  // (con su propio progreso en vivo).
  const count = processed.size;
  if (latexOn) progress.completePhase(count, 'latex');
  if (htmlOn) progress.completePhase(count, 'html');
  if (epubOn) progress.completePhase(count, 'epub');
  if (mdOn) progress.completePhase(count, 'markdown');
  progress.completePhase(count, 'render');

  await pdfConsumer.drain();
  return { processed };
}

/** Contexto compartido por el pool de formatos ligeros. */
interface FormatPoolCtx {
  ctx: BuildContext;
  plan: BuildMetadata;
  formatCfg: FormatConfig | undefined;
  formatsDir: string;
  userFilters: string[];
  globalBibliography: string | undefined;
  lang: string;
  logoInline: string | undefined;
  filters: Awaited<ReturnType<typeof loadFilterGroups>>;
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  preambleFilters: Awaited<ReturnType<typeof loadPreambleFilters>> | undefined;
  renderDocPaths: Set<string>;
  htmlPaths: Set<string>;
  epubPaths: Set<string>;
  mdPaths: Set<string>;
  pdfPaths: Set<string>;
  pdfJobs: PdfJob[];
  noExport: boolean;
}

/** Procesa todos los formatos de un documento: AST → tex/HTML/EPUB/MD → .tex completo → cola PDF. */
async function processDocumentFormats(doc: BuildDocument, pool: FormatPoolCtx, discoveryIndex: Map<string, DiscoveryEntry>): Promise<void> {
  const {
    ctx,
    plan,
    formatCfg,
    formatsDir,
    userFilters,
    globalBibliography,
    lang,
    logoInline,
    filters,
    bibOptions,
    bibFiles,
    preambleFilters,
    renderDocPaths,
    htmlPaths,
    epubPaths,
    mdPaths,
    pdfPaths,
    pdfJobs,
    noExport,
  } = pool;
  const { htmlOn, epubOn, mdOn, latexOn, pdfOn } = plan;
  const htmlConfig = formatCfg?.html;
  const cwd = ctx.cwd;
  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const dir = dirname(doc.relativePath);

  // AST: fresco desde markdown si el documento fue re-renderizado; si no,
  // desde el caché en disco (una sola lectura, sin re-lecturas por formato).
  // markdownToAst lanza BuildError si el documento falla: el build aborta con
  // la ruta del archivo (nunca se omite un documento en silencio).
  let ast: Record<string, unknown>;
  if (renderDocPaths.has(doc.relativePath)) {
    ast = await markdownToAst(doc, cwd, ctx.siteConfig, filters);
  } else {
    ast = (await readAstFromCache(cwd, doc)) ?? (await markdownToAst(doc, cwd, ctx.siteConfig, filters)); // caché vacío (p. ej. --no-cache previo)
  }

  // Cuerpo LaTeX + flags: solo si el documento tiene exportación LaTeX/PDF
  // pendiente en este build (el body no se cachea: nadie lo relee).
  let texBody: string | undefined;
  let flags: Awaited<ReturnType<typeof texBodyFromAst>>['flags'] | undefined;
  if ((latexOn || pdfOn) && pdfPaths.has(doc.relativePath)) {
    const result = await texBodyFromAst(ast, doc, filters, bibFiles);
    texBody = result.body;
    flags = result.flags;
  }
  await writeCachedArtifacts(cwd, doc, slug, ast);

  // --no-export: solo actualizar el caché (AST + tex body), sin salidas.
  if (noExport) return;

  const exportDoc = assembleExportDocument(doc, lang, globalBibliography, undefined, ctx.siteConfig.toc);
  const outputBase = (outputDir: string): string => join(outputDir, dir === '.' ? '' : dir, slug);
  // El HTML tiene un caso especial: un archivo index.md se convierte a index.html
  const htmlSlug = htmlSlugFor(doc.relativePath, slug);

  // HTML
  if (htmlOn && htmlPaths.has(doc.relativePath)) {
    // Enlaces a los formatos generados (PDF/LaTeX/EPUB/Markdown); el HTML es la
    // página actual y no se enlaza a sí mismo. Solo formatos activos.
    const formats = [
      ...(plan.pdfOn
        ? [{ href: relativeHref(dir, `${slug}.pdf`), key: 'pdf' as const, name: 'PDF', description: 'Documento final para lectura e impresión' }]
        : []),
      ...(plan.epubOn
        ? [{ href: relativeHref(dir, `${slug}.epub`), key: 'epub' as const, name: 'EPUB', description: 'Edición adaptable para lectura digital' }]
        : []),
      ...(plan.latexOn
        ? [
            {
              href: relativeHref(dir, `${slug}.tex`),
              key: 'latex' as const,
              name: 'LaTeX',
              description: 'Archivo fuente para composición tipográfica',
            },
          ]
        : []),
      ...(plan.mdOn
        ? [{ href: relativeHref(dir, `${slug}.md`), key: 'markdown' as const, name: 'Markdown', description: 'Texto fuente reutilizable y portable' }]
        : []),
    ];
    // La tarjeta identidad enlaza al home solo si existe index.html en la
    // raíz de salida (index.md en la raíz del proyecto); sin él, la tarjeta
    // se renderiza sin enlace (template $if(home-href)$). El href apunta
    // explícitamente a index.html (./index.html, ../index.html, ...):
    // determinista con file:// y en servidores sin directory index.
    const hasHomePage = discoveryIndex.has('index.md');
    const html = await renderHtmlPageFromAst(
      ast,
      doc,
      cwd,
      {
        title: doc.frontmatter.title || slug,
        siteTitle: htmlConfig?.title ?? 'iteraciones',
        tagline: htmlConfig?.tagline ?? 'escribir, compartir, re-existir',
        lang,
        theme: htmlConfig?.theme,
        accent: htmlConfig?.accent,
        css: ctx.needsCss ? relativeHref(dir, 'css/styles.css') : undefined,
        authorMeta: doc.frontmatter.author.join(', '),
        logoInline,
        docTitle: doc.frontmatter.title && doc.frontmatter.title !== 'Sin t\u00edtulo' ? doc.frontmatter.title : undefined,
        subtitle: doc.frontmatter.subtitle,
        date: formatHumanDate(doc.frontmatter.date),
        homeHref: hasHomePage ? relativeHref(dir, 'index.html') : undefined,
        formats: formats.length > 0 ? formats : undefined,
      },
      ctx.siteConfig,
      bibOptions,
      filters,
    );
    await writeOutput(join(formatsDir, 'html', dir, `${htmlSlug}.html`), html);
  }

  // EPUB y Markdown desde el AST canónico
  if (epubOn && epubPaths.has(doc.relativePath)) {
    await convertToEpub(ast, `${outputBase(join(formatsDir, 'html'))}.epub`, exportDoc, userFilters, ctx.siteConfig.toc);
  }
  if (mdOn && mdPaths.has(doc.relativePath)) {
    await convertToMarkdown(ast, `${outputBase(join(formatsDir, 'markdown'))}.md`, exportDoc, userFilters);
  }

  // .tex completo (preámbulo + cuerpo) para LaTeX/PDF
  if ((latexOn || pdfOn) && pdfPaths.has(doc.relativePath)) {
    if (!texBody || !flags) throw new BuildError(`sin cuerpo LaTeX para ${doc.relativePath}`);
    const entry = discoveryIndex.get(doc.relativePath);
    const fullTex = await composeFullTex(
      ctx.siteConfig,
      {
        title: entry?.title ?? doc.frontmatter.title,
        subtitle: entry?.subtitle ?? doc.frontmatter.subtitle,
        author: entry?.author ?? doc.frontmatter.author,
        date: entry?.date ?? doc.frontmatter.date ?? undefined,
        filePath: doc.filePath,
        cwd,
        // La bibliografía efectiva (configurada o auto-descubierta) se
        // referencia en el preámbulo para que biblatex use la misma que citeproc.
        bibliography: bibOptions?.bibliography,
      },
      texBody,
      flags,
      preambleFilters,
      bibFiles,
    );
    await writeOutput(join(formatsDir, 'pdf', dir, `${slug}.tex`), fullTex);
    if (pdfOn) {
      pdfJobs.push({ dir, slug, relativePath: doc.relativePath });
    }
  }
}

/** Escribe un archivo creando su directorio padre. */
async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

/** Lee el logo inline (del proyecto o el por defecto del paquete). */
async function loadLogoInline(cwd: string, logoRel?: string): Promise<string | undefined> {
  const logoSrc = logoRel ? join(cwd, logoRel) : join(import.meta.dir, '../../src/lib/resources/logo.svg');
  try {
    return await Bun.file(logoSrc).text();
  } catch (err) {
    logWarning(`no se pudo leer el logo: ${String(err)}`, 'html');
    return undefined;
  }
}
