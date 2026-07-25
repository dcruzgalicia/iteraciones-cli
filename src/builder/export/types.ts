import type { BuildDocument, DocumentType } from '../types.js';

export type ExportFormat = 'pdf' | 'epub' | 'md';

/** Tipos de documento que pueden exportarse (clave de LATEX_CLASS). */
export type ExportableDocumentType = keyof typeof LATEX_CLASS;

/**
 * Tipos de documento que producen archivos descargables en el build.
 */
export const EXPORTABLE_TYPES = new Set<DocumentType>(['file', 'event', 'author', 'collection', 'events']);

/**
 * Clase KOMA-Script para cada tipo exportable.
 */
export const LATEX_CLASS = {
  file: 'scrbook',
  event: 'scrbook',
  author: 'scrbook',
  collection: 'scrbook',
  events: 'scrbook',
} as const satisfies Partial<Record<DocumentType, 'scrbook'>>;

/** Una entrada de epigrafe (dictum) con cita y autor opcional. */
export interface DictumEntry {
  /** Texto de la cita. */
  text: string;
  /** Autor del epigrafe (opcional). */
  author?: string;
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
  cover?: string;
  bibliography?: string;
  csl?: string;
  documentclass: 'scrartcl' | 'scrbook';
  toc: boolean;
  tocDepth?: number;
  abstract?: string;
  keywords?: string[];
  dictum?: DictumEntry[];
}

/**
 * Documento listo para exportación.
 */
export interface ExportDocument {
  filePath: string;
  relativePath: string;
  type: ExportableDocumentType;
  body: string;
  htmlBody?: string;
  metadata: ExportMetadata;
  slug?: string;
}

/** Resultado de exportar un documento. */
export interface ExportResult {
  filePath: string;
  relativePath: string;
  pdfPath?: string;
  markdownPath?: string;
  epubPath?: string;
  /** Ruta absoluta a la imagen de portada generada con pdftoppm. */
  coverPath?: string;
}
