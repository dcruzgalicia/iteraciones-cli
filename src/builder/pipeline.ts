import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError, translateSystemError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { killInFlightProcesses, mapWithConcurrency } from '../lib/run.js';
import type { BuildMetadata, WorkSets } from './build-planner.js';
import { htmlSlugFor } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { generateCoverImages } from './export/cover-image.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import { loadFilterGroups } from './filter-resolver.js';
import { composeHtmlTemplate } from './html-composer.js';
import { loadReferencesCardTemplate } from './html-postprocess.js';
import { buildTexDistribution, markdownToLatex, rewriteTexForDist } from './latex-composer.js';
import { applyPrintQueueDynamics, composeLatexTemplate, detectPageSize } from './latex-preamble.js';
import { PDF_WORK_BASE, primaryOutputExtension } from './output-layout.js';
import { createPdfConsumer, type PdfJob } from './pdf-pool.js';
import { loadPreambleFilters } from './preamble-loader.js';
import { htmlPageFromMarkdown } from './render.js';
import { type resolveBibOptions, resolveConfiguredPath } from './state.js';
import type { BuildContext, BuildDocument, BuildReporter, DiscoveryEntry } from './types.js';
import type { PdfXmpMetadata } from './xmpdata.js';
import { injectXmpMetadataIntoLatex } from './xmpdata.js';

/**
 * Límite de compilaciones latexmk simultáneas del pool PDF: cada instancia
 * consume ~300-600 MB de RAM (documentado en architecture.md), así que el
 * pool tiene un tope propio, independiente de la concurrencia general, para
 * que una máquina con muchos núcleos no sature la memoria.
 */
const PDF_MAX_SLOTS = 4;

/** Número de slots del pool PDF para una concurrencia general dada. */
export function pdfSlotCount(concurrency: number): number {
  return Math.max(1, Math.min(concurrency, PDF_MAX_SLOTS));
}

/** Recursos compartidos resueltos una vez por build (bibliografía, lang, logo). */
interface PipelineSetup {
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  globalBibliography: string | undefined;
  /** CSL configurado (no el empaquetado): el export Markdown lo incrusta como ruta de proyecto portable. */
  globalCsl: string | undefined;
  lang: string;
  logoInline: string | undefined;
}

/**
 * Resuelve lo compartido del pipeline. La bibliografía ya se resolvió UNA vez
 * por build en la planificación (#2167): aquí solo se redistribuye.
 */
async function resolvePipelineSetup(ctx: BuildContext, plan: BuildMetadata, formatCfg: SiteConfig['format'] | undefined): Promise<PipelineSetup> {
  const siteConfig = ctx.siteConfig;
  // El default vive en DEFAULT_SITE_CONFIG (es-MX): el fallback local no debe
  // divergir de la configuración (un lang distinto emite --metadata distinto).
  return {
    bibOptions: plan.bibOptions,
    bibFiles: plan.bibFiles,
    globalBibliography: plan.bibOptions?.bibliography,
    globalCsl: siteConfig.csl?.trim() ? resolveConfiguredPath(ctx.cwd, siteConfig.csl.trim()) : undefined,
    lang: siteConfig.language ?? DEFAULT_SITE_CONFIG.language,
    logoInline: await loadLogoInline(ctx.cwd, formatCfg?.html?.site?.logo?.trim()),
  };
}

/** Unión de documentos con trabajo: exportSets (formatos activos) + docsChanged. */
function collectWorkDocs(work: WorkSets, allDocs: BuildDocument[]): BuildDocument[] {
  const workDocs = new Map<string, BuildDocument>();
  for (const doc of [...work.exportSets.latex, ...work.exportSets.html, ...work.exportSets.epub, ...work.exportSets.markdown]) {
    workDocs.set(doc.relativePath, doc);
  }
  for (const doc of allDocs) {
    if (work.docsChanged.has(doc.relativePath)) workDocs.set(doc.relativePath, doc);
  }
  return [...workDocs.values()];
}

/** Estado derivado de los preamble filters activos (#1970/#1975) + artefactos escritos. */
interface EffectiveTemplates {
  /** true si 11-bibliography está activo (flags.lua consulta biblatex-available). */
  biblatexAvailable: boolean;
  /** true si 99-pdfx está activo: inyección de XMP/Info en el .tex. */
  pdfxActive: boolean;
  /** true si 98-crop está activo: bleed (+6mm) en endpapers y crop/pdfx. */
  cropActive: boolean;
  /** Dimensiones de página en mm (para preprocesamiento de imágenes). */
  pageDimensions: { w: number; h: number; textW: number } | undefined;
  htmlTemplatePath: string;
  latexTemplatePath: string;
  /** Wrapper de la tarjeta Referencias (recurso card-referencias-block.html). */
  refsCardTemplate: string;
}

/**
 * Escribe los templates efectivos (una vez por build, sin dependencia del
 * documento): HTML y LaTeX con preamble filters dinámicos. Sin generación
 * LaTeX devuelve el estado neutro (biblatex disponible, sin señal pdfx/crop).
 */
async function writeEffectiveTemplates(
  ctx: BuildContext,
  plan: BuildMetadata,
  htmlOn: boolean,
  siteConfig: SiteConfig,
  bibFiles: string[],
  effectiveDisabledPreamble: string[],
): Promise<EffectiveTemplates> {
  const state: EffectiveTemplates = {
    biblatexAvailable: true,
    pdfxActive: false,
    cropActive: false,
    pageDimensions: undefined,
    htmlTemplatePath: '',
    latexTemplatePath: '',
    refsCardTemplate: '',
  };

  const templatesDir = join(ctx.cwd, '.iteraciones', 'templates');
  await mkdir(templatesDir, { recursive: true });
  state.htmlTemplatePath = join(templatesDir, 'html.html');
  state.latexTemplatePath = join(templatesDir, 'latex.tex');
  // Wrapper de la tarjeta Referencias: recurso estático compuesto una vez por
  // build (el marcador {{refs-list}} recibe la lista extraída por documento).
  state.refsCardTemplate = await loadReferencesCardTemplate();

  if (htmlOn) {
    await writeIfChanged(state.htmlTemplatePath, await composeHtmlTemplate(siteConfig));
  }
  // Preamble filters efectivos: determinan el flag biblatex-available que
  // flags.lua consulta antes de inyectar \\printbibliography (desactivar
  // 11-bibliography sin guarda produciría un comando indefinido).
  if (plan.generateLatex) {
    const preambleFilters = await loadPreambleFilters(effectiveDisabledPreamble, ctx.cwd);
    state.biblatexAvailable = preambleFilters.some((f) => f.name === '11-bibliography');
    state.pdfxActive = preambleFilters.some((f) => f.name === '99-pdfx');
    state.cropActive = preambleFilters.some((f) => f.name === '98-crop');
    state.pageDimensions = detectPageSize(preambleFilters);
    // Generación dinámica de 98-crop y 99-pdfx según tamaño de página (#1975).
    applyPrintQueueDynamics(preambleFilters, state.pageDimensions);
    await writeIfChanged(
      state.latexTemplatePath,
      await composeLatexTemplate({
        pageNumber: siteConfig.format?.pdf?.pageNumber ?? DEFAULT_SITE_CONFIG.format.pdf.pageNumber,
        toc: siteConfig.toc,
        preambleFilters,
        bibFiles,
      }),
    );
  }
  return state;
}

/** Pre-crea los directorios de caché de biber (uno por slot del pool PDF). */
async function ensureBiberCaches(cwd: string, maxSlots: number): Promise<void> {
  const biberBase = join(cwd, '.iteraciones', 'biber');
  await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
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
export async function documentPipeline(
  progress: BuildReporter,
  ctx: BuildContext,
  plan: BuildMetadata,
  work: WorkSets,
  allDocs: BuildDocument[],
  formatCfg: SiteConfig['format'] | undefined,
  discoveryIndex: Map<string, DiscoveryEntry>,
  /** Lista efectiva de preamble filters desactivados (la config del usuario no se muta, #2022). */
  effectiveDisabledPreamble: string[],
): Promise<{ processed: Set<string> }> {
  const { activeFormats } = plan;
  const pdfOn = activeFormats.pdf;

  // ── Configuración compartida (bibliografía, lang, logo) ──
  const setup = await resolvePipelineSetup(ctx, plan, formatCfg);

  // Documentos con trabajo este build
  const workDocList = collectWorkDocs(work, allDocs);

  // ── Templates efectivos (una vez por build, no dependen del documento) ──
  const templates = await writeEffectiveTemplates(ctx, plan, activeFormats.html, ctx.siteConfig, setup.bibFiles, effectiveDisabledPreamble);

  // ── Pool 2 (PDF): cachés de biber + consumidor arrancado en paralelo con el pool 1 ──
  const maxSlots = pdfOn ? pdfSlotCount(ctx.concurrency) : 0;
  if (pdfOn && maxSlots > 0) {
    await ensureBiberCaches(ctx.cwd, maxSlots);
  }
  const pdfWorkBase = join(ctx.cwd, PDF_WORK_BASE);
  const biberBase = join(ctx.cwd, '.iteraciones', 'biber');
  const pdfConsumer = createPdfConsumer(pdfWorkBase, biberBase, maxSlots, progress);
  if (pdfOn && work.exportSets.latex.length > 0) {
    // Los workers arrancan antes del pool 1: latexmk se solapa con pandoc.
    pdfConsumer.start();
  }

  // ── Pool 1 (formatos ligeros): ejecución concurrente por documento ──
  const { processed } = await runLightFormatsPool(progress, ctx, plan, formatCfg, discoveryIndex, {
    workDocList,
    siteConfig: ctx.siteConfig,
    lang: setup.lang,
    logoInline: setup.logoInline,
    bibOptions: setup.bibOptions,
    bibFiles: setup.bibFiles,
    globalBibliography: setup.globalBibliography,
    globalCsl: setup.globalCsl,
    biblatexAvailable: templates.biblatexAvailable,
    pdfxActive: templates.pdfxActive,
    cropActive: templates.cropActive,
    pageDimensions: templates.pageDimensions,
    htmlTemplatePath: templates.htmlTemplatePath,
    latexTemplatePath: templates.latexTemplatePath,
    refsCardTemplate: templates.refsCardTemplate,
    htmlPaths: new Set(work.exportSets.html.map((d) => d.relativePath)),
    epubPaths: new Set(work.exportSets.epub.map((d) => d.relativePath)),
    mdPaths: new Set(work.exportSets.markdown.map((d) => d.relativePath)),
    latexPaths: new Set(work.exportSets.latex.map((d) => d.relativePath)),
    pdfJobs: pdfConsumer.pdfJobs,
    // Fallo del pool 1: cancelar la cola PDF para que los workers salgan sin
    // compilar lo pendiente, ESPERAR a los que están en vuelo (#2013: un
    // latexmk vivo ejecutaría su rename hacia dist/ después del fallo) y
    // recién entonces propagar el error.
    onFatalError: async () => {
      pdfConsumer.cancel();
      await pdfConsumer.quiesce();
    },
  });

  // Pool 1 sin errores: se cierra la cola de producción del pool 2.
  pdfConsumer.markProducerDone();

  // Completar las subtareas de los formatos ligeros activos y la fase render:
  // su trabajo ocurre dentro del pool 1, así que el tracker avanza al grupo
  // 'Generando formatos' mientras los PDFs siguen compilando en el pool 2
  // (con su propio progreso en vivo).
  const count = processed.size;
  if (activeFormats.latex) progress.completePhase(count, 'latex');
  if (activeFormats.html) progress.completePhase(count, 'html');
  if (activeFormats.epub) progress.completePhase(count, 'epub');
  if (activeFormats.markdown) progress.completePhase(count, 'markdown');
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

/** Argumentos fijados una vez por build para el pool de formatos ligeros. */
interface LightPoolArgs {
  workDocList: BuildDocument[];
  siteConfig: SiteConfig;
  lang: string;
  logoInline: string | undefined;
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  globalBibliography: string | undefined;
  globalCsl: string | undefined;
  biblatexAvailable: boolean;
  pdfxActive: boolean;
  cropActive: boolean;
  pageDimensions: { w: number; h: number; textW: number } | undefined;
  htmlTemplatePath: string;
  latexTemplatePath: string;
  refsCardTemplate: string;
  htmlPaths: Set<string>;
  epubPaths: Set<string>;
  mdPaths: Set<string>;
  latexPaths: Set<string>;
  pdfJobs: PdfJob[];
  onFatalError: () => Promise<void>;
}

/**
 * Pool 1 — ejecuta processDocumentFormats con concurrencia general y registra
 * progreso por documento. Si un documento falla se cancelan los PDFs vía
 * onFatalError y el error se propaga tras quiescer los workers.
 */
async function runLightFormatsPool(
  progress: BuildReporter,
  ctx: BuildContext,
  plan: BuildMetadata,
  formatCfg: SiteConfig['format'] | undefined,
  discoveryIndex: Map<string, DiscoveryEntry>,
  args: LightPoolArgs,
): Promise<{ processed: Set<string> }> {
  const filters = await loadFilterGroups(args.siteConfig, args.siteConfig.disabledFilters, ctx.cwd);
  const renderCtx: RenderContext = {
    ctx,
    plan,
    formatCfg,
    lang: args.lang,
    logoInline: args.logoInline,
    warnedLangs: new Set<string>(),
    pdfxActive: args.pdfxActive,
    cropActive: args.cropActive,
    pageDimensions: args.pageDimensions,
  };
  const exportCtx: ExportContext = {
    filters,
    bibOptions: args.bibOptions,
    bibFiles: args.bibFiles,
    biblatexAvailable: args.biblatexAvailable,
    globalBibliography: args.globalBibliography,
    globalCsl: args.globalCsl,
    pdfWorkDir: join(ctx.cwd, PDF_WORK_BASE),
    htmlTemplatePath: args.htmlTemplatePath,
    latexTemplatePath: args.latexTemplatePath,
    refsCardTemplate: args.refsCardTemplate,
  };
  const formatWorkSets: FormatWorkSets = {
    htmlPaths: args.htmlPaths,
    epubPaths: args.epubPaths,
    mdPaths: args.mdPaths,
    latexPaths: args.latexPaths,
    pdfJobs: args.pdfJobs,
  };

  const processed = new Set<string>();
  progress.startLightFormats();
  try {
    await mapWithConcurrency(
      args.workDocList,
      ctx.concurrency,
      async (doc) => {
        await processDocumentFormats(doc, renderCtx, exportCtx, formatWorkSets, discoveryIndex);
        processed.add(doc.relativePath);
        progress.reportFile({ relativePath: doc.relativePath, phase: 'render' });
      },
      // Al fallar un documento: no más items nuevos y kill de los procesos
      // en vuelo (pandoc/latexmk) para que ningún hermano escriba en dist/
      // después del error (#2172).
      { onCancel: () => killInFlightProcesses() },
    );
  } catch (err) {
    await args.onFatalError();
    throw err;
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
  formatCfg: SiteConfig['format'] | undefined;
  lang: string;
  logoInline: string | undefined;
  /** Registro de langs advertidos (babelOptionsForLang): una vez por build. */
  warnedLangs: Set<string>;
  /** 99-pdfx activo: el .tex se inyecta con los metadatos XMP/Info (issue #1970). */
  pdfxActive: boolean;
  /** 98-crop activo: controla bleed (+6mm) en endpapers y crop/pdfx. */
  cropActive: boolean;
  /** Dimensiones de página en mm (para preprocesamiento de imágenes). */
  pageDimensions: { w: number; h: number; textW: number } | undefined;
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
  /** CSL configurado del proyecto: viaja al ExportDocument (EPUB/Markdown). */
  globalCsl: string | undefined;
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

/** Lee el markdown del documento y valida el cuerpo; null = omitido (aviso emitido). */
async function readMarkdownOrWarn(doc: BuildDocument): Promise<string | null> {
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
    return null;
  }
  return content;
}

/** Enlaces a los formatos generados que aparecen en la página HTML. */
function formatLinksFor(
  plan: BuildMetadata,
  dir: string,
  outSlug: string,
): { href: string; key: 'pdf' | 'epub' | 'latex' | 'markdown'; name: string; description: string }[] {
  const formats = [];
  if (plan.activeFormats.pdf) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('pdf')}`),
      key: 'pdf' as const,
      name: 'PDF',
      description: 'Documento final para lectura e impresión',
    });
  }
  if (plan.activeFormats.epub) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('epub')}`),
      key: 'epub' as const,
      name: 'EPUB',
      description: 'Edición adaptable para lectura digital',
    });
  }
  if (plan.activeFormats.latex) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('latex')}`),
      key: 'latex' as const,
      name: 'LaTeX',
      description: 'Archivo fuente para composición tipográfica',
    });
  }
  if (plan.activeFormats.markdown) {
    formats.push({
      href: relativeHref(dir, `${outSlug}${primaryOutputExtension('markdown')}`),
      key: 'markdown' as const,
      name: 'Markdown',
      description: 'Texto fuente reutilizable y portable',
    });
  }
  return formats;
}

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
async function processDocumentFormats(
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

/**
 * Genera el .tex completo y PUBLICA según formatos: con LaTeX escribe el tex
 * distribuido (portable, ADR #2084) y, si PDF está activo, ENCOLA la
 * compilación al pool 2 — esta función es la frontera explícita entre pools:
 * nada de latexmk ocurre aquí, solo producción de jobs para pdf-pool.ts.
 */
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
