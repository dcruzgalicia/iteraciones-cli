import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { translateSystemError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { recordSupportCommand } from '../lib/script-recorder.js';
import type { BuildMetadata, WorkSets } from './build-planner.js';
import { loadFilterGroups } from './filter-resolver.js';
import { composeHtmlTemplate, type HtmlDocType } from './html-composer.js';
import { loadReferencesCardTemplate } from './html-postprocess.js';
import { applyPrintQueueDynamics, composeLatexTemplate, detectPageSize } from './latex-preamble.js';
import { PDF_WORK_BASE } from './output-layout.js';
import type { PdfJob } from './pdf-pool.js';
import { writeIfChanged } from './pipeline-io.js';
import { disableBibliographyWithoutBibFiles, loadPreambleFilters, type PreambleDocType } from './preamble-loader.js';
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

export async function loadLogoInline(cwd: string, logoRel?: string): Promise<string | undefined> {
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
  /** #2488 — la de `file` es la de `html`; cada type con HTML tiene la suya. */
  templates: Record<TemplateKind, string>;
  /** #2488 — el bloque de la tarjeta de referencias de cada type. */
  refsCardTemplates: Record<HtmlDocType, string>;
}

/**
 * #2445 — las cinco plantillas que pandoc recibe por `--template`; #2488 — con el
 * diseño HTML por type son siete: `html` es la de `file`, y cada type con HTML
 * tiene la suya (`intervention` no genera HTML y por eso no tiene).
 */
export type TemplateKind = 'html' | 'html-collection' | 'html-creator' | 'latex' | 'latex-collection' | 'latex-creator' | 'latex-intervention';

const TEMPLATE_FILES: Record<TemplateKind, string> = {
  html: 'html.html',
  'html-collection': 'html-collection.html',
  'html-creator': 'html-creator.html',
  latex: 'latex.tex',
  'latex-collection': 'latex-collection.tex',
  'latex-creator': 'latex-creator.tex',
  'latex-intervention': 'latex-intervention.tex',
};

/** #2488 — el type cuyas tarjetas compone el HTML. `intervention` no genera
 * HTML (`docProducesFormat`), así que no llega aquí. */
function htmlDocTypeOf(kind: TemplateKind): HtmlDocType | undefined {
  if (kind === 'html') return 'file';
  if (kind === 'html-collection') return 'collection';
  if (kind === 'html-creator') return 'creator';
  return undefined;
}

/** #2488 — de qué type es cada plantilla: el ámbito de preamble de LaTeX y el
 * type cuyas tarjetas compone el HTML. Por eso ya no es `Exclude<…, 'html'>`. */
const TEMPLATE_SCOPES: Record<TemplateKind, PreambleDocType> = {
  html: 'file',
  'html-collection': 'collection',
  'html-creator': 'creator',
  latex: 'file',
  'latex-collection': 'collection',
  'latex-creator': 'creator',
  'latex-intervention': 'intervention',
};

export const TEMPLATE_KINDS = Object.keys(TEMPLATE_FILES) as TemplateKind[];
export const templatePathFor = (kind: TemplateKind, templatesDir: string): string => join(templatesDir, TEMPLATE_FILES[kind]);

const PREAMBLE_TEMPLATE_KINDS = ['latex', 'latex-collection', 'latex-creator', 'latex-intervention'] as const satisfies readonly TemplateKind[];

export function latexKindFor(type: PreambleDocType | undefined): TemplateKind {
  return type === undefined || type === 'file' ? 'latex' : `latex-${type}`;
}

export function htmlKindFor(type: HtmlDocType): TemplateKind {
  return type === 'file' ? 'html' : `html-${type}`;
}

export interface TemplateInput {
  cwd: string;
  siteConfig: SiteConfig;
  bibFiles: string[];
  effectiveDisabledPreamble: string[];
  logoInline?: string;
}

/** Compartida: la usa el build y `iteraciones template`, para byte-idéntico. */
export async function composeTemplate(kind: TemplateKind, input: TemplateInput): Promise<string> {
  const htmlType = htmlDocTypeOf(kind);
  if (htmlType !== undefined) return composeHtmlTemplate(input.siteConfig, input.logoInline, htmlType);
  const scope = TEMPLATE_SCOPES[kind];
  const filters = await loadPreambleFilters(input.effectiveDisabledPreamble, input.cwd, scope);
  // Misma cadena que el build: sin estas dos líneas la plantilla no sale igual.
  const dims = detectPageSize(filters);
  return composeLatexTemplate({
    toc: input.siteConfig.toc,
    bibFiles: input.bibFiles,
    preambleFilters: applyPrintQueueDynamics(filters, dims),
  });
}

export async function writeEffectiveTemplates(
  ctx: BuildContext,
  plan: BuildMetadata,
  htmlOn: boolean,
  siteConfig: SiteConfig,
  bibFiles: string[],
  effectiveDisabledPreamble: string[],
  logoInline?: string,
): Promise<EffectiveTemplates> {
  const templatesDir = join(ctx.cwd, '.iteraciones', 'templates');
  await mkdir(templatesDir, { recursive: true });
  const state: EffectiveTemplates = {
    biblatexAvailable: true,
    pdfxActive: false,
    cropActive: false,
    pageDimensions: undefined,
    templates: Object.fromEntries(TEMPLATE_KINDS.map((kind) => [kind, templatePathFor(kind, templatesDir)])) as Record<TemplateKind, string>,
    refsCardTemplates: { file: '', collection: '', creator: '' },
  };

  // #2488 — el bloque de referencias también es una tarjeta por type
  state.refsCardTemplates = {
    file: await loadReferencesCardTemplate('file'),
    collection: await loadReferencesCardTemplate('collection'),
    creator: await loadReferencesCardTemplate('creator'),
  };

  // #2419: sin archivos `.bib` no hay nada que citar, así que el preamble de
  // biblatex no se compone. Regla compartida con `iteraciones template` (el .sh
  // regenera estas mismas plantillas) y con `iteraciones filters`.
  const disabledPreamble = disableBibliographyWithoutBibFiles(effectiveDisabledPreamble, bibFiles);
  const tpl: TemplateInput = { cwd: ctx.cwd, siteConfig, bibFiles, effectiveDisabledPreamble: disabledPreamble, logoInline };
  const writeTemplate = async (kind: TemplateKind): Promise<void> => {
    const path = state.templates[kind];
    await writeIfChanged(path, await composeTemplate(kind, tpl));
    // Recurso de la fase 2: el .sh la puede regenerar sin pandoc ni el build.
    recordSupportCommand('resources', path, ['iteraciones', 'template', kind, '-o', path]);
  };

  if (htmlOn) {
    await writeTemplate('html');
    await writeTemplate('html-collection');
    await writeTemplate('html-creator');
  }
  if (plan.generateLatex) {
    for (const kind of PREAMBLE_TEMPLATE_KINDS) {
      const preambleFilters = await loadPreambleFilters(disabledPreamble, ctx.cwd, TEMPLATE_SCOPES[kind]);
      const pageDimensions = detectPageSize(preambleFilters);
      applyPrintQueueDynamics(preambleFilters, pageDimensions);
      // Sólo el ámbito `file` describe el documento: las banderas y el tamaño de
      // página que consume el pipeline son los suyos.
      if (TEMPLATE_SCOPES[kind] === 'file') {
        state.biblatexAvailable = preambleFilters.some((f) => f.name === '11-bibliography');
        state.pdfxActive = preambleFilters.some((f) => f.name === '99-pdfx');
        state.cropActive = preambleFilters.some((f) => f.name === '98-crop');
        state.pageDimensions = pageDimensions;
      }
      await writeTemplate(kind);
    }
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
  warnedLangs: Set<string>;
  pdfxActive: boolean;
  cropActive: boolean;
  pageDimensions: { w: number; h: number; textW: number } | undefined;
}

/** Las nueve rutas y banderas de plantilla vienen de `EffectiveTemplates`. */
export interface ExportContext extends EffectiveTemplates {
  filters: Awaited<ReturnType<typeof loadFilterGroups>>;
  bibOptions: Awaited<ReturnType<typeof resolveBibOptions>>['bibOptions'];
  bibFiles: string[];
  globalBibliography: string | undefined;
  globalCsl: string | undefined;
  pdfWorkDir: string;
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
    warnedLangs: new Set<string>(),
    pdfxActive: templates.pdfxActive,
    cropActive: templates.cropActive,
    pageDimensions: templates.pageDimensions,
  };
  const exportCtx: ExportContext = {
    filters,
    bibOptions: setup.bibOptions,
    bibFiles: setup.bibFiles,
    globalBibliography: setup.globalBibliography,
    globalCsl: setup.globalCsl,
    pdfWorkDir: join(ctx.cwd, PDF_WORK_BASE),
    ...templates,
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
