import type { SiteConfig } from '../config/config-schema.js';

export interface DiscoveryEntry {
  title: string;
  subtitle?: string;
  author: string[];
  date?: string;
  slug?: string;
  /** Slug fijado por el usuario en el frontmatter (campo slug:). */
  slugFixed?: boolean;
  /** Valor del slug manual del frontmatter (resuelto por resolveSlugs). */
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
  author: string[];
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
