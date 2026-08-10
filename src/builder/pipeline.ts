import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ProgressTracker } from '../cli/progress.js';
import { DEFAULT_SITE_CONFIG, type FormatConfig } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import type { BuildMetadata, WorkSets } from './build-planner.js';
import { htmlSlugFor } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import { composeLatexTemplate } from './latex-preamble.js';
import { createPdfConsumer, type PdfJob } from './pdf-pool.js';
import { loadPreambleFilters } from './preamble-loader.js';
import { composeHtmlTemplate, htmlPageFromMarkdown, loadFilterGroups, markdownToLatex } from './render.js';
import { resolveBibOptions } from './state.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

/**
 * Ejecuta el pipeline por documento (fases 2-6 fusionadas):
 *
 * Pool 1 (formatos ligeros, concurrencia general): para cada documento, lee
 * el body del markdown una sola vez y genera cada formato activo con una
 * invocación directa de pandoc (markdown → latex/html5/epub3/markdown), con
 * los templates efectivos compuestos una vez por build y los filtros Lua por
 * capa. Encuela la compilación PDF.
 *
 * Pool 2 (PDF, concurrencia CPU − 1): consume la cola de jobs producida por
 * el pool 1 mientras este sigue trabajando, solapando latexmk con pandoc.
 *
 * No hay AST intermedio: cada conversión sale del markdown original.
 *
 * Retorna los relativePath procesados y el total de documentos.
 */
export async function runDocumentPipeline(
  progress: ProgressTracker,
  ctx: BuildContext,
  plan: BuildMetadata,
  work: WorkSets,
  formatCfg: FormatConfig | undefined,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<{ processed: Set<string> }> {
  const { pdfOn, latexOn, htmlOn, epubOn, mdOn } = plan;
  const siteConfig = ctx.siteConfig;
  // La bibliografía se resuelve una sola vez por build y se comparte con todos
  // los documentos.
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

  // ── Templates efectivos (una vez por build, no dependen del documento) ──
  const templatesDir = join(ctx.cwd, '.iteraciones', 'templates');
  await mkdir(templatesDir, { recursive: true });
  const htmlTemplatePath = join(templatesDir, 'html.html');
  const latexTemplatePath = join(templatesDir, 'latex.tex');
  if (htmlOn) {
    await writeIfChanged(htmlTemplatePath, await composeHtmlTemplate(siteConfig));
  }
  if (plan.generateLatex) {
    const preambleFilters = await loadPreambleFilters(siteConfig.format?.pdf?.disabledPreambleFilters, ctx.cwd);
    await writeIfChanged(
      latexTemplatePath,
      await composeLatexTemplate({
        pageNumber: siteConfig.format?.pdf?.pageNumber ?? DEFAULT_SITE_CONFIG.format.pdf.pageNumber,
        toc: siteConfig.toc,
        preambleFilters,
        bibFiles,
      }),
    );
  }

  // Pre-crear directorios de caché de biber (uno por slot de concurrencia de PDF).
  const maxSlots = pdfOn ? Math.max(1, ctx.concurrency) : 0;
  const biberBase = join(ctx.cwd, '.iteraciones', 'biber');
  if (pdfOn && maxSlots > 0) {
    await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
  }

  // ── Pool 2 (PDF): consumidor de la cola, arranca en paralelo con el pool 1 ──
  const pdfWorkBase = join(ctx.cwd, '.iteraciones', 'tmp', 'pdf');
  const pdfConsumer = createPdfConsumer(pdfWorkBase, biberBase, maxSlots, progress);
  if (pdfOn && work.exportSets.pdf.length > 0) {
    // Los workers arrancan antes del pool 1: latexmk se solapa con pandoc.
    pdfConsumer.start();
  }

  // ── Pool 1 (formatos ligeros) ──
  const processed = new Set<string>();
  const htmlPaths = new Set(work.exportSets.html.map((d) => d.relativePath));
  const epubPaths = new Set(work.exportSets.epub.map((d) => d.relativePath));
  const mdPaths = new Set(work.exportSets.markdown.map((d) => d.relativePath));
  const pdfPaths = new Set(work.exportSets.pdf.map((d) => d.relativePath));
  const filters = await loadFilterGroups(siteConfig, siteConfig.disabledFilters, ctx.cwd);

  progress.startLightFormats();
  try {
    await mapWithConcurrency(workDocList, ctx.concurrency, async (doc) => {
      await processDocumentFormats(
        doc,
        {
          ctx,
          plan,
          formatCfg,
          pdfWorkDir: pdfWorkBase,
          globalBibliography,
          lang,
          logoInline,
          filters,
          bibOptions,
          bibFiles,
          htmlTemplatePath,
          latexTemplatePath,
          htmlPaths,
          epubPaths,
          mdPaths,
          pdfPaths,
          pdfJobs: pdfConsumer.pdfJobs,
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

/**
 * Contexto compartido por el pool de formatos ligeros: rutas, config y
 * conjuntos de trabajo por formato para un build. Inmutable durante el pool.
 */
interface FormatPoolCtx {
  ctx: BuildContext;
  plan: BuildMetadata;
  formatCfg: FormatConfig | undefined;
  pdfWorkDir: string;
  globalBibliography: string | undefined;
  lang: string;
  logoInline: string | undefined;
  filters: Awaited<ReturnType<typeof loadFilterGroups>>;
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  htmlTemplatePath: string;
  latexTemplatePath: string;
  htmlPaths: Set<string>;
  epubPaths: Set<string>;
  mdPaths: Set<string>;
  pdfPaths: Set<string>;
  pdfJobs: PdfJob[];
}

/** Procesa todos los formatos de un documento: markdown → tex/HTML/EPUB/MD → cola PDF. */
async function processDocumentFormats(doc: BuildDocument, pool: FormatPoolCtx, discoveryIndex: Map<string, DiscoveryEntry>): Promise<void> {
  const {
    ctx,
    plan,
    formatCfg,
    pdfWorkDir,
    globalBibliography,
    lang,
    logoInline,
    filters,
    bibOptions,
    bibFiles,
    htmlTemplatePath,
    latexTemplatePath,
    htmlPaths,
    epubPaths,
    mdPaths,
    pdfPaths,
    pdfJobs,
  } = pool;
  const { htmlOn, epubOn, mdOn, latexOn, pdfOn } = plan;
  const htmlConfig = formatCfg?.html;
  const cwd = ctx.cwd;
  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const dir = dirname(doc.relativePath);

  // El markdown original completo (el frontmatter fluye a pandoc como metadata):
  // se lee una sola vez y se reutiliza en todas las conversiones del documento.
  let content: string;
  try {
    content = await Bun.file(doc.filePath).text();
  } catch (err) {
    throw new BuildError(`no se pudo leer "${doc.filePath}": ${String(err)}`);
  }
  // Validación: el documento debe tener cuerpo después del frontmatter
  if (!splitFrontmatter(content).body.trim()) {
    throw new BuildError(`"${doc.filePath}" no tiene contenido después del frontmatter`);
  }

  const entry = discoveryIndex.get(doc.relativePath);
  const fm = entry?.fm ?? {};
  const needsLatex = (latexOn || pdfOn) && pdfPaths.has(doc.relativePath);
  const outBase = (name: string): string => join(ctx.outputDir, dir === '.' ? '' : dir, name);
  const texDistPath = outBase(`${slug}.tex`);

  // .tex completo (preámbulo + cuerpo) en UNA invocación markdown → latex,
  // escrito directamente en dist/ (o en el área de trabajo del PDF si solo pdfOn)
  if (needsLatex) {
    const fullTex = await markdownToLatex(content, doc, filters, bibFiles, latexTemplatePath, fm, ctx.siteConfig);
    if (latexOn) {
      await writeOutput(texDistPath, fullTex);
    }
    if (pdfOn) {
      const texPath = latexOn ? texDistPath : join(pdfWorkDir, dir, `${slug}.tex`);
      if (!latexOn) await writeOutput(texPath, fullTex);
      pdfJobs.push({ dir, slug, relativePath: doc.relativePath, texPath, pdfDest: outBase(`${slug}.pdf`) });
    }
  }

  const exportDoc = assembleExportDocument(doc, lang, globalBibliography, undefined, ctx.siteConfig.toc);
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
    const html = await htmlPageFromMarkdown(
      content,
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
      htmlTemplatePath,
      fm,
      bibOptions,
      filters,
    );
    await writeOutput(outBase(`${htmlSlug}.html`), html);
  }

  // EPUB y Markdown desde el markdown original, directo a dist/
  if (epubOn && epubPaths.has(doc.relativePath)) {
    await convertToEpub(content, outBase(`${slug}.epub`), exportDoc, filters, ctx.siteConfig.toc, fm);
  }
  if (mdOn && mdPaths.has(doc.relativePath)) {
    await convertToMarkdown(content, outBase(`${slug}.md`), exportDoc, filters, fm);
  }
}

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

/** Escribe un archivo creando su directorio padre. */
async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

/**
 * Escribe el archivo solo si el contenido cambió respecto al existente.
 * Evita tocar el disco cuando el contenido es idéntico (consistente con la
 * filosofía de caché del resto del pipeline: nada se escribe sin necesidad).
 */
async function writeIfChanged(path: string, content: string): Promise<void> {
  if (await Bun.file(path).exists()) {
    try {
      const existing = await Bun.file(path).text();
      if (existing === content) return;
    } catch {
      // Archivo ilegible: se reescribe
    }
  }
  await writeOutput(path, content);
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
