import { join } from 'node:path';
import type { FormatKey } from '../config/site-config.js';

export const DIST_DIR = 'dist';

export const DIST_FILES_DIR = join(DIST_DIR, 'files');

export const ASSETS_IMAGES_DIR = 'assets/images';

export const ASSETS_PDF_IMAGES_DIR = 'assets/pdf/images';

/** Las listas por keyword viven en su propia carpeta. */
export const KEYWORDS_DIR = 'keywords';

export const ASSETS_CSS_FILE = 'assets/css/styles.css';

export const ASSETS_FONTS_DIR = 'assets/fonts';

/** El logo raster ya convertido: el HTML lo referencia en vez de incrustarlo. */
export const ASSETS_LOGO_WEBP = 'assets/images/logo.webp';

export const ASSETS_FAVICON_PNG = 'assets/images/favicon.png';

export const ASSETS_FAVICON_SVG = 'assets/images/favicon.svg';

/** Ruta del logo en la maqueta vieja; sólo se usa para limpiar. */
export const ASSETS_LOGO_FILE = 'assets/logo.svg';

export const LEGACY_ASSETS_IMG_DIR = 'assets/img';

export const PDF_WORK_DIR = join('tmp', 'pdf');

export const PDF_WORK_BASE = join('.iteraciones', PDF_WORK_DIR);

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

export function docProducesFormat(type: string | undefined, format: FormatKey): boolean {
  if (type === 'intervention') return format === 'latex' || format === 'pdf' || format === 'markdown';
  if (type === 'list' || type === 'menu' || type === 'announcement') return format === 'html';
  return true;
}
