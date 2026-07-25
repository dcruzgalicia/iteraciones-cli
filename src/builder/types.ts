import type { SiteConfig } from '../config/site-config.js';
import type { Frontmatter } from '../lib/frontmatter.js';

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
