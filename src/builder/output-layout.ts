import { join } from 'node:path';
import type { FormatKey } from '../config/site-config.js';

export const DIST_DIR = 'dist';

export const DIST_FILES_DIR = join(DIST_DIR, 'files');

/**
 * #2450 — todo lo estático vive dentro de `assets/`, por nivel: las imágenes en
 * `<nivel>/assets/images` (una sola copia por imagen, de la que dependen html,
 * markdown y .tex) y el css, las fuentes y el logo en `assets/` de la raíz.
 */
export const ASSETS_IMAGES_DIR = 'assets/images';

export const ASSETS_CSS_FILE = 'assets/css/styles.css';

export const ASSETS_FONTS_DIR = 'assets/fonts';

export const ASSETS_LOGO_FILE = 'assets/logo.svg';

/** Ruta de imágenes anterior (#2450); la detecta el build para migrar. */
export const LEGACY_ASSETS_IMG_DIR = 'assets/img';

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
