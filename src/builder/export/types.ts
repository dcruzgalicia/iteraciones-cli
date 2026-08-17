/** Metadatos que se inyectan en el YAML header del documento Pandoc. */
export interface ExportMetadata {
  title: string;
  author: string[];
  /** Fecha legible (formato humano, para el YAML del export Markdown). */
  date?: string;
  /** Fecha cruda del frontmatter (ISO yyyy-mm-dd, para dc:date del EPUB). */
  dateIso?: string;
  lang: string;
  bibliography?: string;
  csl?: string;
  toc: boolean;
  tocDepth?: number;
}

/** Documento listo para exportación. */
export interface ExportDocument {
  filePath: string;
  relativePath: string;
  metadata: ExportMetadata;
  slug?: string;
}
