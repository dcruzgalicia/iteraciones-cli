import type { SiteConfig } from '../config/site-config.js';
import type { Frontmatter } from '../loader/frontmatter.js';
import type { TemplateContext } from '../template/render/context.js';

export type DocumentKind = 'page' | 'block';

export type DocumentType = 'file' | 'collection' | 'author' | 'authors' | 'event' | 'events' | 'menu' | 'card' | 'list';

export type Region = 'content-before' | 'content-after' | 'sidebar-primary' | 'sidebar-secondary' | 'footer-left' | 'footer-center' | 'footer-right';

/**
 * Índice de documentos de tipo `author` indexados por su título normalizado
 * (lowercase, trimmed). Usado para resolución eficiente de autores relacionados
 * y ponentes de eventos durante la fase de construcción de contexto.
 */
export type AuthorDocumentIndex = ReadonlyMap<string, BuildDocument>;

/**
 * Documento fuente tal como sale del paso de discovery.
 * Contiene el contenido Markdown, frontmatter parseado y metadatos de archivo.
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
 * Nace en classify (type, kind, templatePath) y recibe htmlFragment en render,
 * templateContext en context, outputHtml en compose y outputPath en write.
 */
export interface BuildDocument extends SourceDocument {
  // Asignado en classify
  type?: DocumentType;
  kind?: DocumentKind;
  templatePath?: string;
  // Asignado en render
  htmlFragment?: string;
  // Asignado en context
  templateContext?: TemplateContext;
  // Asignado en compose
  outputHtml?: string;
  // Asignado en write
  outputPath?: string;
}

/**
 * Contexto de ejecución del pipeline: config, rutas y opciones de build.
 */
export interface BuildContext {
  siteConfig: SiteConfig;
  cwd: string;
  outputDir: string;
  cssPath: string;
  /** Máximo de invocaciones pandoc simultáneas. Default: 4. */
  concurrency?: number;
}
