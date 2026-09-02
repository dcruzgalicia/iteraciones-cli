import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
import type { resolveBibOptions } from './state-bib.js';
import type { BuildContext } from './types.js';

export interface PipelineSetup {
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  globalBibliography: string | undefined;
  globalCsl: string | undefined;
  lang: string;
  logoInline: string | undefined;
}

export async function resolvePipelineSetup(
  ctx: BuildContext,
  plan: BuildMetadata,
  formatCfg: SiteConfig['format'] | undefined,
): Promise<PipelineSetup> {
  const siteConfig = ctx.siteConfig;
  return {
    bibOptions: plan.bibOptions,
    bibFiles: plan.bibFiles,
    globalBibliography: plan.bibOptions?.bibliography,
    globalCsl: siteConfig.csl?.trim() ? resolve(ctx.cwd, siteConfig.csl.trim()) : undefined,
    lang: siteConfig.language ?? DEFAULT_SITE_CONFIG.language,
    logoInline: await loadLogoInline(ctx.cwd, formatCfg?.html?.site?.logo?.trim()),
  };
}

async function loadLogoInline(cwd: string, logoRel?: string): Promise<string | undefined> {
  const logoSrc = logoRel ? join(cwd, logoRel) : join(import.meta.dir, '../../src/lib/resources/logo.svg');
  try {
    return await Bun.file(logoSrc).text();
  } catch (err) {
    logWarning(`no se pudo leer el logo: ${translateSystemError(err)}`, 'html');
    return undefined;
  }
}

export interface EffectiveTemplates {
  biblatexAvailable: boolean;
  pdfxActive: boolean;
  cropActive: boolean;
  pageDimensions: { w: number; h: number; textW: number } | undefined;
  htmlTemplatePath: string;
  latexTemplatePath: string;
  latexCollectionTemplatePath: string;
  refsCardTemplate: string;
}

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
    latexCollectionTemplatePath: '',
    refsCardTemplate: '',
  };

  const templatesDir = join(ctx.cwd, '.iteraciones', 'templates');
  await mkdir(templatesDir, { recursive: true });
  state.htmlTemplatePath = join(templatesDir, 'html.html');
  state.latexTemplatePath = join(templatesDir, 'latex.tex');
  state.latexCollectionTemplatePath = join(templatesDir, 'latex-collection.tex');
  state.refsCardTemplate = await loadReferencesCardTemplate();

  if (htmlOn) {
    await writeIfChanged(state.htmlTemplatePath, await composeHtmlTemplate(siteConfig));
  }
  if (plan.generateLatex) {
    const preambleFilters = await loadPreambleFilters(effectiveDisabledPreamble, ctx.cwd, 'file');
    state.biblatexAvailable = preambleFilters.some((f) => f.name === '11-bibliography');
    state.pdfxActive = preambleFilters.some((f) => f.name === '99-pdfx');
    state.cropActive = preambleFilters.some((f) => f.name === '98-crop');
    state.pageDimensions = detectPageSize(preambleFilters);
    applyPrintQueueDynamics(preambleFilters, state.pageDimensions);
    const templateOpts = {
      pageNumber: siteConfig.format?.pdf?.pageNumber ?? DEFAULT_SITE_CONFIG.format.pdf.pageNumber,
      toc: siteConfig.toc,
      bibFiles,
    };
    await writeIfChanged(state.latexTemplatePath, await composeLatexTemplate({ ...templateOpts, preambleFilters }));

    const collectionPreambleFilters = await loadPreambleFilters(effectiveDisabledPreamble, ctx.cwd, 'collection');
    const collectionPageDimensions = detectPageSize(collectionPreambleFilters);
    applyPrintQueueDynamics(collectionPreambleFilters, collectionPageDimensions);
    await writeIfChanged(
      state.latexCollectionTemplatePath,
      await composeLatexTemplate({ ...templateOpts, preambleFilters: collectionPreambleFilters }),
    );
  }
  return state;
}

export async function ensureBiberCaches(cwd: string, maxSlots: number): Promise<void> {
  const biberBase = join(cwd, '.iteraciones', 'biber');
  await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
}

export interface RenderContext {
  ctx: BuildContext;
  plan: BuildMetadata;
  formatCfg: SiteConfig['format'] | undefined;
  lang: string;
  logoInline: string | undefined;
  warnedLangs: Set<string>;
  pdfxActive: boolean;
  cropActive: boolean;
  pageDimensions: { w: number; h: number; textW: number } | undefined;
}

export interface ExportContext {
  filters: Awaited<ReturnType<typeof loadFilterGroups>>;
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  biblatexAvailable: boolean;
  globalBibliography: string | undefined;
  globalCsl: string | undefined;
  pdfWorkDir: string;
  htmlTemplatePath: string;
  latexTemplatePath: string;
  latexCollectionTemplatePath: string;
  refsCardTemplate: string;
}

export interface FormatWorkSets {
  htmlPaths: Set<string>;
  epubPaths: Set<string>;
  mdPaths: Set<string>;
  latexPaths: Set<string>;
  pdfJobs: PdfJob[];
}

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
    latexCollectionTemplatePath: templates.latexCollectionTemplatePath,
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
