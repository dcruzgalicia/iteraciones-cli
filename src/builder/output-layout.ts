import { join } from 'node:path';
import type { FormatKey } from '../config/site-config.js';

/**
 * Contrato de salida (fuente única, #2174): la forma de las rutas de dist/
 * y la extensión de cada formato. El pipeline GENERA según este contrato y
 * cleanup LIMPIA según el mismo: desajustarse deja huérfanos — p. ej.
 * index.md produce index.* pero su slug de título es otro.
 */

/** Directorio de salida por defecto, relativo a la raíz del proyecto. */
export const DIST_DIR = 'dist';

/** Subdirectorio de documentos dentro de dist/ (css, fonts y logo viven junto a él). */
export const DIST_FILES_DIR = join(DIST_DIR, 'files');

/** Área de trabajo de compilación PDF (auxiliares de latexmk, por slot), relativa a la raíz. */
export const PDF_WORK_BASE = join('.iteraciones', 'tmp', 'pdf');

/**
 * Extensiones de salida por formato. `pdf` incluye `.png`: la imagen de
 * portada opcional (format.pdf.cover-image) se genera junto al PDF.
 */
export const FORMAT_OUTPUT_EXTENSIONS: Record<FormatKey, string[]> = {
  latex: ['.tex'],
  pdf: ['.pdf', '.png'],
  html: ['.html'],
  epub: ['.epub'],
  markdown: ['.md'],
};

/** Unión de todas las extensiones de salida de documentos (limpieza por slug). */
export const ALL_OUTPUT_EXTENSIONS: string[] = [...new Set(Object.values(FORMAT_OUTPUT_EXTENSIONS).flat())];

/** Extensión principal de un formato: la del archivo que enlaza la página HTML. */
export function primaryOutputExtension(format: FormatKey): string {
  return FORMAT_OUTPUT_EXTENSIONS[format][0] ?? '';
}
