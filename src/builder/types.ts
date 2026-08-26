import type { SiteConfig } from '../config/config-schema.js';

export interface DiscoveryEntry {
  title: string;
  subtitle?: string;
  creator: string[];
  date?: string;
  slug?: string;
  /** Valor del slug manual del frontmatter (campo slug:); undefined = automático. */
  manualSlug?: string;
  /** Frontmatter YAML completo parseado: fluye a pandoc como metadata del documento. */
  fm?: Record<string, unknown>;
  /** mtime (ms) del archivo en el último build (caché content-addressed). */
  mtime?: number;
  /** Tamaño del archivo en el último build. */
  size?: number;
  /** sha256 del contenido (solo se calcula cuando el mtime cambió con el mismo tamaño). */
  hash?: string;
}

export interface Frontmatter {
  title: string;
  subtitle?: string;
  date: string;
  creator: string[];
}

/**
 * Documento que acumula datos a través del pipeline.
 * Creado en discovery; el export lee el AST del caché en disco
 * (`.iteraciones/ast/`) cuando el documento no se re-renderizó en el build.
 */
export interface BuildDocument {
  filePath: string;
  relativePath: string;
  frontmatter: Frontmatter;
  slug?: string;
}

/**
 * Contexto de ejecución del pipeline: config, rutas y opciones de build.
 */
export interface BuildContext {
  siteConfig: SiteConfig;
  cwd: string;
  outputDir: string;
  needsCss: boolean;
  /** Máximo de invocaciones pandoc simultáneas. Default: CPU - 1. */
  concurrency: number;
}

// ── Reporteo de progreso (inversión builder→cli, issue #2017) ──────────────

/** Fases del pipeline que el reporter puede declarar y actualizar. */
export type PipelinePhase = 'discovery' | 'render' | 'latex' | 'markdown' | 'pdf' | 'epub' | 'html';

/** Formato configurado (generate true/false) declarado al tracker. */
export interface FormatState {
  phase: PipelinePhase;
  active: boolean;
}

/** Aviso de un archivo procesado (fila del tracker). */
export interface RenderFileReport {
  relativePath: string;
  phase: PipelinePhase;
}

/**
 * Contrato de reporteo del build: el builder emite eventos; la CLI decide
 * cómo presentarlos (tracker interactivo, verbose, JSON) inyectando su
 * implementación en `build()`. Dirección de dependencia: cli → builder.
 * Sin reporter inyectado, `build()` usa `silentReporter` (headless).
 */
export interface BuildReporter {
  setFormats(formats: FormatState[]): void;
  planPhases(phases: PipelinePhase[]): void;
  startPhase(phase: PipelinePhase, total?: number): void;
  reportFile(file: RenderFileReport): void;
  completePhase(actualCount?: number, phaseOverride?: PipelinePhase): void;
  log(message: string): void;
  addWarning(message: string): void;
  addSummaryLine(line: string): void;
  showCleanup(): void;
  startLightFormats(): void;
  finish(processed: number, cached: number, formats?: string[], outputDir?: string, invalidations?: string[]): Promise<void>;
  fail(): Promise<void>;
}
