import { join } from 'node:path';
import type { FormatKey } from '../config/site-config.js';

export const DIST_DIR = 'dist';

export const DIST_FILES_DIR = join(DIST_DIR, 'files');

export const PDF_WORK_BASE = join('.iteraciones', 'tmp', 'pdf');

export const FORMAT_OUTPUT_EXTENSIONS: Record<FormatKey, string[]> = {
  latex: ['.tex'],
  pdf: ['.pdf', '.png'],
  html: ['.html'],
  epub: ['.epub'],
  markdown: ['.md'],
};

export const ALL_OUTPUT_EXTENSIONS: string[] = [...new Set(Object.values(FORMAT_OUTPUT_EXTENSIONS).flat())];

export function primaryOutputExtension(format: FormatKey): string {
  return FORMAT_OUTPUT_EXTENSIONS[format][0] ?? '';
}
