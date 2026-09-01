import type { SiteConfig } from '../config/config-schema.js';

export interface DiscoveryEntry {
  title: string;
  subtitle?: string;
  creator: string[];
  date?: string;
  slug?: string;
  manualSlug?: string;
  type?: 'file' | 'collection';
  files?: string[];
  fm?: Record<string, unknown>;
  mtime?: number;
  size?: number;
  hash?: string;
}

interface Frontmatter {
  title: string;
  subtitle?: string;
  date: string;
  creator: string[];
  type?: 'file' | 'collection';
  files?: string[];
}

export interface BuildDocument {
  filePath: string;
  relativePath: string;
  frontmatter: Frontmatter;
  slug?: string;
}

export interface BuildContext {
  siteConfig: SiteConfig;
  cwd: string;
  outputDir: string;
  needsCss: boolean;
  concurrency: number;
}

export type PipelinePhase = 'discovery' | 'render' | 'latex' | 'markdown' | 'pdf' | 'epub' | 'html';

export interface FormatState {
  phase: PipelinePhase;
  active: boolean;
}

export interface RenderFileReport {
  relativePath: string;
  phase: PipelinePhase;
}

export interface BuildReporter {
  setFormats(formats: FormatState[]): void;
  planPhases(phases: PipelinePhase[]): void;
  startPhase(phase: PipelinePhase, total?: number): void;
  reportFile(file: RenderFileReport): void;
  completePhase(actualCount?: number, phaseOverride?: PipelinePhase): void;
  log(message: string): void;
  addWarning(message: string): void;
  addSummaryLine(line: string): void;
  showCleanup(): void;
  startLightFormats(): void;
  finish(processed: number, cached: number, formats?: string[], outputDir?: string, invalidations?: string[]): Promise<void>;
  fail(): Promise<void>;
}
