import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { translateSystemError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import type { BuildMetadata, WorkSets } from './build-planner.js';
import { loadFilterGroups } from './filter-resolver.js';
import { composeHtmlTemplate } from './html-composer.js';
import { loadReferencesCardTemplate } from './html-postprocess.js';
import { applyPrintQueueDynamics, composeLatexTemplate, detectPageSize } from './latex-preamble.js';
import { PDF_WORK_BASE } from './output-layout.js';
import type { PdfJob } from './pdf-pool.js';
import { writeIfChanged } from './pipeline-io.js';
import { loadPreambleFilters } from './preamble-loader.js';
import { type resolveBibOptions, resolveConfiguredPath } from './state.js';
import type { BuildContext } from './types.js';

/**
 * Configuración compartida del pipeline, resuelta UNA vez por build (#2176):
 * setup (bibliografía, lang, logo), templates efectivos y los contextos
 * inmutables que viajan al pool de formatos ligeros. Sin orquestación de
 * pools ni procesamiento por documento: esos viven en pipeline.ts y
 * pipeline-formats.ts.
 */

/** Recursos compartidos resueltos una vez por build (bibliografía, lang, logo). */
export interface PipelineSetup {
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
export async function resolvePipelineSetup(
  ctx: BuildContext,
  plan: BuildMetadata,
  formatCfg: SiteConfig['format'] | undefined,
): Promise<PipelineSetup> {
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

/** Estado derivado de los preamble filters activos (#1970/#1975) + artefactos escritos. */
export interface EffectiveTemplates {
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
export async function writeEffectiveTemplates(
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
export async function ensureBiberCaches(cwd: string, maxSlots: number): Promise<void> {
  const biberBase = join(cwd, '.iteraciones', 'biber');
  await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
}

/** Contexto de render por documento: build, plan y config de formato. */
export interface RenderContext {
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
export interface ExportContext {
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
export interface FormatWorkSets {
  htmlPaths: Set<string>;
  epubPaths: Set<string>;
  mdPaths: Set<string>;
  latexPaths: Set<string>;
  pdfJobs: PdfJob[];
}

/**
 * Construye los contextos inmutables del pool de formatos ligeros a partir
 * del setup y los templates ya resueltos: una sola construcción por build
 * (#2176) en lugar de un paquete plano de 22 campos.
 */
export async function buildPoolContexts(
  ctx: BuildContext,
  plan: BuildMetadata,
  work: WorkSets,
  formatCfg: SiteConfig['format'] | undefined,
  setup: PipelineSetup,
  templates: EffectiveTemplates,
  pdfJobs: PdfJob[],
): Promise<{ renderCtx: RenderContext; exportCtx: ExportContext; formatWorkSets: FormatWorkSets }> {
  const filters = await loadFilterGroups(ctx.siteConfig, ctx.siteConfig.disabledFilters, ctx.cwd);
  const renderCtx: RenderContext = {
    ctx,
    plan,
    formatCfg,
    lang: setup.lang,
    logoInline: setup.logoInline,
    warnedLangs: new Set<string>(),
    pdfxActive: templates.pdfxActive,
    cropActive: templates.cropActive,
    pageDimensions: templates.pageDimensions,
  };
  const exportCtx: ExportContext = {
    filters,
    bibOptions: setup.bibOptions,
    bibFiles: setup.bibFiles,
    biblatexAvailable: templates.biblatexAvailable,
    globalBibliography: setup.globalBibliography,
    globalCsl: setup.globalCsl,
    pdfWorkDir: join(ctx.cwd, PDF_WORK_BASE),
    htmlTemplatePath: templates.htmlTemplatePath,
    latexTemplatePath: templates.latexTemplatePath,
    refsCardTemplate: templates.refsCardTemplate,
  };
  const formatWorkSets: FormatWorkSets = {
    htmlPaths: work.workPaths.html,
    epubPaths: work.workPaths.epub,
    mdPaths: work.workPaths.markdown,
    latexPaths: work.workPaths.print,
    pdfJobs,
  };
  return { renderCtx, exportCtx, formatWorkSets };
}
