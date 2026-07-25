import type { SiteConfig } from '../config/site-config.js';

export interface Frontmatter {
  title: string;
  date: string;
  author: string[];
  type: string;
  keywords: string[];
  [key: string]: unknown;
}

/**
 * Normaliza un valor desconocido a un array de strings no vacíos con trim.
 */
export function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Documento fuente tal como sale del paso de discovery.
 */
export interface SourceDocument {
  filePath: string;
  relativePath: string;
  frontmatter: Frontmatter;
  body: string;
  sourceHash: string;
  mtimeMs: number;
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
export interface BuildContext {
  siteConfig: SiteConfig;
  cwd: string;
  outputDir: string;
  cssPath: string;
  /** Máximo de invocaciones pandoc simultáneas. Default: CPU - 1. */
  concurrency?: number;
}
