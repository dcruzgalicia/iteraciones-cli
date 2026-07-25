/** Una entrada de epigrafe (dictum) con cita y autor opcional. */
export interface DictumEntry {
  text: string;
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

/** Documento listo para exportación. */
export interface ExportDocument {
  filePath: string;
  relativePath: string;
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
  coverPath?: string;
}
