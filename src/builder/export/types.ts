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
