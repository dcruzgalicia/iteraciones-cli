import type { SiteConfig } from '../config/site-config.js';

export interface DiscoveryEntry {
  title: string;
  subtitle?: string;
  author: string[];
  date?: string;
  slug?: string;
  /** mtime (ms) del archivo en el último build (caché content-addressed). */
  mtime?: number;
  /** Tamaño del archivo en el último build. */
  size?: number;
  /** sha256 del contenido (solo se calcula cuando el mtime cambió con el mismo tamaño). */
  hash?: string;
}

export type DiscoveryIndex = Map<string, DiscoveryEntry>;

export interface Frontmatter {
  title: string;
  subtitle?: string;
  date: string;
  author: string[];
}

/**
 * Documento que acumula datos a través del pipeline.
 * Creado en discovery; los exports leen sus inputs (AST/LaTeX/HTML) del caché
 * en disco (`.iteraciones/ast/`, `.iteraciones/tex/`, `.iteraciones/html/`).
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
  cssPath: string;
  /** Máximo de invocaciones pandoc simultáneas. Default: CPU - 1. */
  concurrency: number;
}

/** Flags de preámbulo calculados desde el AST (estructura real del documento). */
export interface PreambleFlags {
  /** ¿Existen nodos Header? (para evitar un TOC vacío). */
  hasTocEntries: boolean;
  /** ¿El primer bloque es un heading o un dictum/verse? (no anteponer \\noindent). */
  skipNoIndent: boolean;
  /** ¿El primer bloque es un heading? (no anteponer \\vspace*{2\\baselineskip}). */
  skipParagraphSpace: boolean;
}
