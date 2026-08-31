export interface ExportMetadata {
  title: string;
  creator: string[];
  date?: string;
  dateIso?: string;
  language: string;
  bibliography?: string;
  csl?: string;
  toc: boolean;
  tocDepth?: number;
}

export interface ExportDocument {
  filePath: string;
  relativePath: string;
  metadata: ExportMetadata;
  slug?: string;
}
