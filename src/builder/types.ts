import type { SiteConfig } from '../config/site-config.js';

export interface DiscoveryEntry {
  title: string;
  author: string[];
  slug?: string;
}

export type DiscoveryIndex = Map<string, DiscoveryEntry>;

export interface Frontmatter {
  title: string;
  date: string;
  author: string[];
  keywords: string[];
  [key: string]: unknown;
}

/**
 * Documento fuente tal como sale del paso de discovery.
 */
export interface SourceDocument {
  filePath: string;
  relativePath: string;
  frontmatter: Frontmatter;
}

/**
 * Documento que acumula datos a través del pipeline.
 */
export interface BuildDocument extends SourceDocument {
  slug?: string;
  htmlFragment?: string;
  /** Cuerpo LaTeX generado en renderLatex. */
  processedBody?: string;
}

/**
 * Contexto de ejecución del pipeline: config, rutas y opciones de build.
 */
/** Retorna true si el frontmatter tiene export.skip=true. */
export function isExportSkipped(frontmatter: Frontmatter): boolean {
  const raw = frontmatter.export;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>).skip === true;
}

export interface BuildContext {
  siteConfig: SiteConfig;
  cwd: string;
  outputDir: string;
  cssPath: string;
  /** Máximo de invocaciones pandoc simultáneas. Default: CPU - 1. */
  concurrency?: number;
}
