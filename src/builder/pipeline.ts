import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ProgressTracker } from '../cli/progress.js';
import { DEFAULT_SITE_CONFIG, type FormatConfig } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError, translateSystemError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import type { BuildMetadata, WorkSets } from './build-planner.js';
import { htmlSlugFor } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { generateCoverImages } from './export/cover-image.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import { loadFilterGroups } from './filter-resolver.js';
import { composeHtmlTemplate, loadReferencesCardTemplate } from './html-composer.js';
import { markdownToLatex } from './latex-composer.js';
import { applyPrintQueueDynamics, composeLatexTemplate, detectPageSize } from './latex-preamble.js';
import { createPdfConsumer, type PdfJob } from './pdf-pool.js';
import { loadPreambleFilters } from './preamble-loader.js';
import { htmlPageFromMarkdown } from './render.js';
import { resolveBibOptions } from './state.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';
import type { PdfXmpMetadata } from './xmpdata.js';
import { injectXmpMetadataIntoLatex } from './xmpdata.js';

/**
 * Límite de compilaciones latexmk simultáneas del pool PDF: cada instancia
 * consume ~300-600 MB de RAM (documentado en architecture.md), así que el
 * pool tiene un tope propio, independiente de la concurrencia general, para
 * que una máquina con muchos núcleos no sature la memoria.
 */
export const PDF_MAX_SLOTS = 4;

/** Número de slots del pool PDF para una concurrencia general dada. */
export function pdfSlotCount(concurrency: number): number {
  return Math.max(1, Math.min(concurrency, PDF_MAX_SLOTS));
}

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
  allDocs: BuildDocument[],
  formatCfg: FormatConfig | undefined,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<{ processed: Set<string> }> {
  const { activeFormats } = plan;
  const pdfOn = activeFormats.pdf;
  const latexOn = activeFormats.latex;
  const htmlOn = activeFormats.html;
  const epubOn = activeFormats.epub;
  const mdOn = activeFormats.markdown;
  const siteConfig = ctx.siteConfig;
  // La bibliografía se resuelve una sola vez por build y se comparte con todos
  // los documentos.
  const bib = await resolveBibOptions(ctx.cwd, siteConfig);
  const bibOptions = bib.bibOptions;
  const bibFiles = bib.bibFiles;
  const globalBibliography = bibOptions?.bibliography;
  // El default vive en DEFAULT_SITE_CONFIG (es-MX): el fallback local no debe
  // divergir de la configuración (un lang distinto emite --metadata distinto).
  const lang = siteConfig.language ?? DEFAULT_SITE_CONFIG.language;
  const htmlConfig = formatCfg?.html;
  const logoInline = await loadLogoInline(ctx.cwd, htmlConfig?.site?.logo?.trim());

  // Unión de todos los documentos con trabajo este build: los de los exportSets
  // (formatos activos) y los de docsChanged (markdown/filters modificados).
  const workDocs = new Map<string, BuildDocument>();
  for (const doc of [...work.exportSets.latex, ...work.exportSets.html, ...work.exportSets.epub, ...work.exportSets.markdown]) {
    workDocs.set(doc.relativePath, doc);
  }
  for (const doc of allDocs) {
    if (work.docsChanged.has(doc.relativePath)) workDocs.set(doc.relativePath, doc);
  }
  const workDocList = [...workDocs.values()];

  // ── Templates efectivos (una vez por build, no dependen del documento) ──
  const templatesDir = join(ctx.cwd, '.iteraciones', 'templates');
  await mkdir(templatesDir, { recursive: true });
  const htmlTemplatePath = join(templatesDir, 'html.html');
  const latexTemplatePath = join(templatesDir, 'latex.tex');
  // Wrapper de la tarjeta Referencias: recurso estático compuesto una vez por
  // build (el marcador {{refs-list}} recibe la lista extraída por documento).
  const refsCardTemplate = await loadReferencesCardTemplate();
  if (htmlOn) {
    await writeIfChanged(htmlTemplatePath, await composeHtmlTemplate(siteConfig));
  }
  // Preamble filters efectivos: determinan el flag biblatex-available que
  // flags.lua consulta antes de inyectar \\printbibliography (desactivar
  // 11-bibliography sin guarda produciría un comando indefinido).
  let biblatexAvailable = true;
  // 99-pdfx activo: señal de "quiero certificar PDF/X"; activa la inyección de
  // los metadatos XMP/Info en el .tex (issue #1970).
  let pdfxActive = false;
  // 98-crop activo: controla el bleed (+6mm) en endpapers y crop/pdfx.
  let cropActive = false;
  // Dimensiones de página en mm (para preprocesamiento de imágenes).
  let pageDimensions: { w: number; h: number } | undefined;
  if (plan.generateLatex) {
    const preambleFilters = await loadPreambleFilters(siteConfig.format?.pdf?.disabledPreambleFilters, ctx.cwd);
    biblatexAvailable = preambleFilters.some((f) => f.name === '11-bibliography');
    pdfxActive = preambleFilters.some((f) => f.name === '99-pdfx');
    cropActive = preambleFilters.some((f) => f.name === '98-crop');
    pageDimensions = detectPageSize(preambleFilters);
    // Generación dinámica de 98-crop y 99-pdfx según tamaño de página (#1975).
    applyPrintQueueDynamics(preambleFilters);
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
  const maxSlots = pdfOn ? pdfSlotCount(ctx.concurrency) : 0;
  const biberBase = join(ctx.cwd, '.iteraciones', 'biber');
  if (pdfOn && maxSlots > 0) {
    await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
  }

  // ── Pool 2 (PDF): consumidor de la cola, arranca en paralelo con el pool 1 ──
  const pdfWorkBase = join(ctx.cwd, '.iteraciones', 'tmp', 'pdf');
  const pdfConsumer = createPdfConsumer(pdfWorkBase, biberBase, maxSlots, progress);
  if (pdfOn && work.exportSets.latex.length > 0) {
    // Los workers arrancan antes del pool 1: latexmk se solapa con pandoc.
    pdfConsumer.start();
  }

  // ── Pool 1 (formatos ligeros) ──
  const processed = new Set<string>();
  const htmlPaths = new Set(work.exportSets.html.map((d) => d.relativePath));
  const epubPaths = new Set(work.exportSets.epub.map((d) => d.relativePath));
  const mdPaths = new Set(work.exportSets.markdown.map((d) => d.relativePath));
  // Documentos que generan .tex (para latexOn y/o pdfOn)
  const latexPaths = new Set(work.exportSets.latex.map((d) => d.relativePath));
  const filters = await loadFilterGroups(siteConfig, siteConfig.disabledFilters, ctx.cwd);

  progress.startLightFormats();
  const renderCtx = { ctx, plan, formatCfg, lang, logoInline, warnedLangs: new Set<string>(), pdfxActive, cropActive, pageDimensions };
  const exportCtx = {
    filters,
    bibOptions,
    bibFiles,
    biblatexAvailable,
    globalBibliography,
    pdfWorkDir: pdfWorkBase,
    htmlTemplatePath,
    latexTemplatePath,
    refsCardTemplate,
  };
  const formatWorkSets = { htmlPaths, epubPaths, mdPaths, latexPaths, pdfJobs: pdfConsumer.pdfJobs };
  try {
    await mapWithConcurrency(workDocList, ctx.concurrency, async (doc) => {
      await processDocumentFormats(doc, renderCtx, exportCtx, formatWorkSets, discoveryIndex);
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

  // Portada PDF opcional (format.pdf.cover-image): tras el vaciado del pool, la
  // imagen se extrae del PDF ya publicado en dist/ con pdftoppm. El PDF no se
  // toca: la portada es derivada y un fallo solo advierte (extra, no bloquea).
  if (pdfOn && formatCfg?.pdf?.coverImage === true) {
    await generateCoverImages(pdfConsumer.pdfJobs.map((job) => ({ pdfPath: job.pdfDest, pngPath: join(dirname(job.pdfDest), `${job.slug}.png`) })));
  }

  return { processed };
}

/**
 * Contexto de render por documento: build, plan y config de formato.
 * Inmutable durante el pool (el Set de langs advertidos es el registro mutable
 * deliberado del build: una vez por build, no por proceso).
 */
interface RenderContext {
  ctx: BuildContext;
  plan: BuildMetadata;
  formatCfg: FormatConfig | undefined;
  lang: string;
  logoInline: string | undefined;
  /** Registro de langs advertidos (babelOptionsForLang): una vez por build. */
  warnedLangs: Set<string>;
  /** 99-pdfx activo: el .tex se inyecta con los metadatos XMP/Info (issue #1970). */
  pdfxActive: boolean;
  /** 98-crop activo: controla bleed (+6mm) en endpapers y crop/pdfx. */
  cropActive: boolean;
  /** Dimensiones de página en mm (para preprocesamiento de imágenes). */
  pageDimensions: { w: number; h: number } | undefined;
}

/**
 * Contexto de exportación compartido: filtros, bibliografía, templates y
 * área de trabajo del PDF. Inmutable durante el pool.
 */
interface ExportContext {
  filters: Awaited<ReturnType<typeof loadFilterGroups>>;
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  /** true si el preamble filter 11-bibliography está activo (flags.lua lo consulta). */
  biblatexAvailable: boolean;
  globalBibliography: string | undefined;
  pdfWorkDir: string;
  htmlTemplatePath: string;
  latexTemplatePath: string;
  /** Wrapper de la tarjeta Referencias (recurso card-referencias-block.html). */
  refsCardTemplate: string;
}

/** Conjuntos de trabajo por formato del build actual. Inmutable durante el pool. */
interface FormatWorkSets {
  htmlPaths: Set<string>;
  epubPaths: Set<string>;
  mdPaths: Set<string>;
  latexPaths: Set<string>;
  pdfJobs: PdfJob[];
}

/**
 * Normaliza un campo del frontmatter crudo aceptando un string o una lista de
 * strings (como author); devuelve undefined si no hay valores útiles.
 */
function frontmatterStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return value.trim() ? [value] : undefined;
  if (Array.isArray(value)) {
    const items = value
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

/**
 * Resuelve el valor de un metadato con precedencia: frontmatter > format config > root config.
 * @param fm Frontmatter del documento
 * @param formatCfg Config del formato actual (e.g., format.pdf)
 * @param rootCfg Config raíz del sitio
 * @param field Nombre del campo DC
 * @returns El valor resuelto o undefined si no existe en ningún nivel
 */
function resolveMetadata(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
  field: string,
): string | string[] | undefined {
  // 1. Frontmatter tiene prioridad
  const fmValue = fm[field];
  if (fmValue !== undefined) {
    if (typeof fmValue === 'string' || Array.isArray(fmValue)) return fmValue;
    return undefined;
  }
  // 2. Config por formato
  if (formatCfg) {
    const fmtValue = formatCfg[field];
    if (fmtValue !== undefined) {
      if (typeof fmtValue === 'string' || Array.isArray(fmtValue)) return fmtValue;
      return undefined;
    }
  }
  // 3. Config raíz
  const rootValue = rootCfg[field];
  if (rootValue !== undefined) {
    if (typeof rootValue === 'string' || Array.isArray(rootValue)) return rootValue;
    return undefined;
  }
  return undefined;
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
    title:
      typeof resolveMetadata(fm, formatCfg, rootCfg, 'title') === 'string' ? (resolveMetadata(fm, formatCfg, rootCfg, 'title') as string) : undefined,
    authors: frontmatterStringList(resolveMetadata(fm, formatCfg, rootCfg, 'creator')),
    lang,
    dateIso:
      typeof resolveMetadata(fm, formatCfg, rootCfg, 'date') === 'string' ? (resolveMetadata(fm, formatCfg, rootCfg, 'date') as string) : undefined,
    subject: frontmatterStringList(resolveMetadata(fm, formatCfg, rootCfg, 'subject'))?.join(', '),
    publishers: frontmatterStringList(resolveMetadata(fm, formatCfg, rootCfg, 'publisher')),
    keywords: frontmatterStringList(resolveMetadata(fm, formatCfg, rootCfg, 'keywords')),
  };
}

/** Procesa todos los formatos de un documento: markdown → tex/HTML/EPUB/MD → cola PDF. */
async function processDocumentFormats(
  doc: BuildDocument,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan, formatCfg, lang, logoInline, warnedLangs, pdfxActive, cropActive, pageDimensions } = renderCtx;
  const { filters, bibOptions, bibFiles, biblatexAvailable, globalBibliography, pdfWorkDir, htmlTemplatePath, latexTemplatePath, refsCardTemplate } =
    exportCtx;
  const { htmlPaths, epubPaths, mdPaths, latexPaths, pdfJobs } = formatWorkSets;
  const { activeFormats } = plan;
  const htmlOn = activeFormats.html;
  const epubOn = activeFormats.epub;
  const mdOn = activeFormats.markdown;
  const latexOn = activeFormats.latex;
  const pdfOn = activeFormats.pdf;
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
    // Con hint de ENOENT: al leer el documento del usuario el motivo común es
    // un nombre mal escrito o un archivo que nunca existió.
    throw new BuildError(`no se pudo leer "${doc.filePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
  // Validación: el documento debe tener cuerpo después del frontmatter. Un
  // documento vacío (o con frontmatter sin cuerpo) se omite con un warning:
  // un accidente de 0 bytes no debe cancelar el build completo.
  const { yaml, body } = splitFrontmatter(content);
  if (!body.trim()) {
    logWarning(
      yaml !== undefined
        ? `"${doc.filePath}" no tiene contenido después del frontmatter; se omite del build`
        : `"${doc.filePath}" está vacío; se omite del build`,
      'build',
    );
    return;
  }

  const entry = discoveryIndex.get(doc.relativePath);
  const fm = entry?.fm ?? {};
  const needsLatex = (latexOn || pdfOn) && latexPaths.has(doc.relativePath);
  const outBase = (name: string): string => join(ctx.outputDir, dir === '.' ? '' : dir, name);
  // Nombre de salida coherente en todos los formatos: index.md → index.* (el
  // caso especial de htmlSlugFor aplica a todo el documento, no solo al HTML;
  // antes, index.md generaba index.html pero inicio.pdf/tex/epub/md).
  const outSlug = htmlSlugFor(doc.relativePath, slug);
  const texDistPath = outBase(`${outSlug}.tex`);

  // .tex completo (preámbulo + cuerpo) en UNA invocación markdown → latex,
  // escrito directamente en dist/ (o en el área de trabajo del PDF si solo pdfOn)
  if (needsLatex) {
    const { tex: fullTex, processedImages } = await markdownToLatex(
      content,
      doc,
      filters,
      bibFiles,
      latexTemplatePath,
      fm,
      ctx.siteConfig,
      biblatexAvailable,
      warnedLangs,
      pageDimensions,
      cropActive,
    );
    // Con 99-pdfx activo se inyectan los metadatos XMP e Info en el .tex
    // (filecontents + \pdfinfo): el tex de dist/ queda autocontenido (issue #1970).
    const texWithXmp = pdfxActive
      ? injectXmpMetadataIntoLatex(
          fullTex,
          xmpMetadataFor(fm, lang, formatCfg?.pdf as Record<string, unknown> | undefined, ctx.siteConfig as Record<string, unknown>),
        )
      : fullTex;
    if (latexOn) {
      await writeOutput(texDistPath, texWithXmp);
      // Copiar imágenes procesadas a dist/ para distribución con LaTeX.
      // Solo copiar archivos que fueron efectivamente procesados (no los originales).
      for (const imgPath of processedImages) {
        if (await Bun.file(imgPath).exists()) {
          await Bun.write(join(ctx.outputDir, basename(imgPath)), Bun.file(imgPath));
        }
      }
    }
    if (pdfOn) {
      const texPath = latexOn ? texDistPath : join(pdfWorkDir, dir, `${outSlug}.tex`);
      if (!latexOn) await writeOutput(texPath, texWithXmp);
      pdfJobs.push({ dir, slug: outSlug, relativePath: doc.relativePath, texPath, pdfDest: outBase(`${outSlug}.pdf`) });
    }
  }

  const exportDoc = assembleExportDocument(doc, lang, globalBibliography, undefined, ctx.siteConfig.toc);

  // HTML
  if (htmlOn && htmlPaths.has(doc.relativePath)) {
    // Enlaces a los formatos generados (PDF/LaTeX/EPUB/Markdown); el HTML es la
    // página actual y no se enlaza a sí mismo. Solo formatos activos.
    const formats = [
      ...(plan.activeFormats.pdf
        ? [{ href: relativeHref(dir, `${outSlug}.pdf`), key: 'pdf' as const, name: 'PDF', description: 'Documento final para lectura e impresión' }]
        : []),
      ...(plan.activeFormats.epub
        ? [{ href: relativeHref(dir, `${outSlug}.epub`), key: 'epub' as const, name: 'EPUB', description: 'Edición adaptable para lectura digital' }]
        : []),
      ...(plan.activeFormats.latex
        ? [
            {
              href: relativeHref(dir, `${outSlug}.tex`),
              key: 'latex' as const,
              name: 'LaTeX',
              description: 'Archivo fuente para composición tipográfica',
            },
          ]
        : []),
      ...(plan.activeFormats.markdown
        ? [
            {
              href: relativeHref(dir, `${outSlug}.md`),
              key: 'markdown' as const,
              name: 'Markdown',
              description: 'Texto fuente reutilizable y portable',
            },
          ]
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
        siteTitle: htmlConfig?.site?.title ?? 'iteraciones',
        tagline: htmlConfig?.site?.description ?? 'escribir, compartir, re-existir',
        lang,
        theme: htmlConfig?.site?.theme,
        accent: htmlConfig?.site?.color,
        css: ctx.needsCss ? relativeHref(dir, 'css/styles.css') : undefined,
        authorMeta: doc.frontmatter.creator.join(', '),
        logoInline,
        docTitle: doc.frontmatter.title && doc.frontmatter.title !== 'Sin t\u00edtulo' ? doc.frontmatter.title : undefined,
        subtitle: doc.frontmatter.subtitle,
        date: formatHumanDate(doc.frontmatter.date),
        homeHref: hasHomePage ? relativeHref(dir, 'index.html') : undefined,
        formats: formats.length > 0 ? formats : undefined,
      },
      ctx.siteConfig,
      htmlTemplatePath,
      refsCardTemplate,
      fm,
      bibOptions,
      filters,
    );
    await writeOutput(outBase(`${outSlug}.html`), html);
  }

  // EPUB y Markdown desde el markdown original, directo a dist/
  if (epubOn && epubPaths.has(doc.relativePath)) {
    await convertToEpub(content, outBase(`${outSlug}.epub`), exportDoc, filters, ctx.siteConfig.toc, fm);
  }
  if (mdOn && mdPaths.has(doc.relativePath)) {
    await convertToMarkdown(content, outBase(`${outSlug}.md`), exportDoc, filters, cwd, fm);
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
    logWarning(`no se pudo leer el logo: ${translateSystemError(err)}`, 'html');
    return undefined;
  }
}
