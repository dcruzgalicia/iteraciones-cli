import type { ExportLatexTemplate } from '../../config/site-config.js';
import type { BuildDocument, DocumentType } from '../types.js';

export type { ExportLatexTemplate } from '../../config/site-config.js';

export type ExportFormat = 'pdf' | 'epub';

/** Tipos de documento que pueden exportarse (clave de LATEX_CLASS). */
export type ExportableDocumentType = keyof typeof LATEX_CLASS;

/**
 * Tipos de documento que producen archivos descargables en el build.
 * Los tipos no exportables (authors, menu, card, list) son estructurales del sitio
 * y no tienen valor como documento impreso independiente.
 */
export const EXPORTABLE_TYPES = new Set<DocumentType>(['file', 'event', 'author', 'collection', 'events']);

/**
 * Clase KOMA-Script para cada tipo exportable.
 * scrartcl: documentos individuales (artículo, evento, currículum).
 * scrbook:  colecciones (libro, programa de actividades).
 */
export const LATEX_CLASS = {
  file: 'scrartcl',
  event: 'scrartcl',
  author: 'scrartcl',
  collection: 'scrbook',
  events: 'scrbook',
} as const satisfies Partial<Record<DocumentType, 'scrartcl' | 'scrbook'>>;

/**
 * Grupo de items dentro de una colección, correspondiente a los `parts:` del frontmatter.
 * Cada parte tiene un nombre y una lista de documentos resueltos.
 */
export interface ExportCollectionPart {
  name: string;
  items: BuildDocument[];
}

/** Metadatos editoriales que se inyectan en el YAML header del documento Pandoc. */
export interface ExportMetadata {
  title: string;
  author: string[];
  date?: string;
  lang: string;
  isbn?: string;
  publisher?: string;
  description?: string;
  rights?: string;
  /** Ruta al archivo de imagen para portada EPUB. */
  cover?: string;
  /** Ruta al archivo BibTeX/CSL para referencias bibliográficas. */
  bibliography?: string;
  /** Ruta al archivo .csl para formato de citas. */
  csl?: string;
  documentclass: 'scrartcl' | 'scrbook';
  /** Si true, incluye tabla de contenidos (solo scrbook). */
  toc: boolean;
  /** Variante de template LaTeX a usar. Sustituye al template base del documentclass. */
  template?: ExportLatexTemplate;
  /** Resumen o abstract del documento (usado por el template `academic`). */
  abstract?: string;
  /** Palabras clave del documento (usadas por el template `academic`). */
  keywords?: string[];
}

/**
 * Documento listo para exportación: body ensamblado y metadatos editoriales.
 * Para tipos scrartcl: body = doc.body sin modificar.
 * Para tipos scrbook: body = capítulos concatenados de todos los items.
 */
export interface ExportDocument {
  /** Ruta absoluta al archivo fuente. Usada como clave en ExportResult. */
  filePath: string;
  /** Ruta relativa dentro del contenido (para construir la ruta de salida). */
  relativePath: string;
  /** Tipo del documento fuente; determina qué template LaTeX/EPUB se resuelve. */
  type: ExportableDocumentType;
  body: string;
  metadata: ExportMetadata;
}

/** Resultado de exportar un documento: rutas a los archivos generados. */
export interface ExportResult {
  /** Igual que ExportDocument.filePath; clave para búsqueda O(1). */
  filePath: string;
  /** relativePath original del documento fuente (no paginado). */
  relativePath: string;
  /** Ruta absoluta al PDF generado (variante perfil); undefined si no se generó. */
  pdfPath?: string;
  /** Ruta absoluta al PDF completo generado (variante completo, solo type author); undefined si no se generó. */
  pdfFullPath?: string;
  /** Ruta absoluta al EPUB generado (variante perfil); undefined si no se generó. */
  epubPath?: string;
  /** Ruta absoluta al EPUB completo generado (variante completo, solo type author); undefined si no se generó. */
  epubFullPath?: string;
  /** Ruta absoluta a la imagen de portada generada con pdftoppm; undefined si no se generó. */
  coverPath?: string;
}
