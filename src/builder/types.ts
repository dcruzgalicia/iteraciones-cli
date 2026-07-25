import type { SiteConfig } from '../config/site-config.js';
import type { Frontmatter } from '../loader/frontmatter.js';

export type DocumentKind = 'page' | 'block';

export type DocumentType = 'file' | 'collection' | 'author' | 'authors' | 'event' | 'events' | 'menu' | 'card' | 'feed' | 'list';

export type Region = 'content-before' | 'content-after' | 'sidebar-primary' | 'sidebar-secondary' | 'footer-left' | 'footer-center' | 'footer-right';

/** Set de todos los valores válidos de `region:` en documentos de tipo bloque. */
export const VALID_REGIONS = new Set<Region>([
  'content-before',
  'content-after',
  'sidebar-primary',
  'sidebar-secondary',
  'footer-left',
  'footer-center',
  'footer-right',
]);

/** Tipos de documento válidos. Derivado manualmente de la unión DocumentType. */
export const VALID_TYPES = new Set<DocumentType>(['file', 'collection', 'author', 'authors', 'event', 'events', 'menu', 'card', 'feed', 'list']);

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
  // Asignado en classify (hoy siempre undefined, se mantiene por compatibilidad export)
  type?: DocumentType;
  kind?: DocumentKind;
  // Asignado en orchestrator (slug computation)
  slug?: string;
  // Asignado en renderLatex
  htmlFragment?: string;
  // Cuerpo LaTeX generado en renderLatex
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
