import { join } from 'node:path';
import { logWarning } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Sistema de filters para el preámbulo LaTeX
// ---------------------------------------------------------------------------
// Cada filter es un archivo de recurso preamble/<prioridad>-<nombre>.tex
// con contenido LaTeX puro (se edita como LaTeX, sin escaping de strings TS).
// El proyecto puede sobreescribir cualquiera con preamble/<nombre>.tex en su
// raíz; si no existe, se usa el recurso del paquete.
//
// La lógica condicional real del proyecto vive en los filtros Lua
// (src/lib/resources/filters/) y en los preamble filters (.tex).
// ---------------------------------------------------------------------------

/** Directorio de preamble filters del paquete. */
const PKG_PREAMBLE_DIR = join(import.meta.dir, '../lib/resources/preamble');

/** Lista de preamble filters empaquetados en orden de aplicación. */
export const BUILTIN_PREAMBLE_FILTERS: string[] = [
  // ── Configuración LaTeX (paquetes y comandos) ──
  '01-documentclass',
  '02-fonts',
  '03-spacing',
  '04-margins',
  '05-language',
  '06-headers',
  '07-typography',
  '08-hyperref',
  '09-tables',
  '10-lists',
  '11-bibliography',
  '12-counters',
  '13-setkomafont',
  '14-sectioning',
  '15-dictum',
  '16-page-number',
  // ── Extras (desactivados por defecto: disabled-preamble-filters) ──
  '17-eso-pic',
  '18-pdfx',
  '19-crop',
  // ── Parches y estilos (preamble filters originales, renumerados) ──
  '20-maketitle-patches',
  '21-environments',
  '22-toc-styling',
  '23-toc-section',
  '24-bibliography-heading',
  '25-hyphenation-rules',
];

const DESCRIPTIONS: Record<string, string> = {
  '01-documentclass': '\\documentclass con clase KOMA-Script y opciones por defecto',
  '02-fonts': 'Codificación (fontenc, inputenc) y fuente principal (mathptmx)',
  '03-spacing': 'Interlineado con setspace (\\setstretch{1.5})',
  '04-margins': 'Márgenes con geometry (2.54cm, carta)',
  '05-language': 'Idioma con babel (español, México)',
  '06-headers': 'Encabezados con scrlayer-scrpage',
  '07-typography': 'Microtipografía (microtype) y penalizaciones de composición',
  '08-hyperref': 'Enlaces PDF (hidelinks)',
  '09-tables': 'Paquetes de tablas (longtable, booktabs, array, calc)',
  '10-lists': 'Listas con enumitem (noitemsep, nosep)',
  '11-bibliography': 'Bibliografía (csquotes, biblatex con estilo APA)',
  '12-counters': 'Contadores de secciones (secnumdepth, tocdepth)',
  '13-setkomafont': 'Fuentes de la portada (\\setkomafont para title, subtitle, author, date)',
  '14-sectioning': 'Estilo de secciones (\\RedeclareSectionCommand para todos los niveles)',
  '15-dictum': 'Configuración de epígrafes (\\dictumwidth, fuente del autor)',
  '16-page-number': 'Posición del número de página (\\ohead*{\\pagemark})',
  '17-eso-pic': 'Fondo de página con eso-pic (desactivado por defecto)',
  '18-pdfx': 'PDF/X-1a para impresión profesional (desactivado por defecto)',
  '19-crop': 'Marcas de corte con crop (desactivado por defecto)',
  '20-maketitle-patches': 'Personaliza \\maketitle: 1+2 baselineskip, titulo en mayusculas',
  '21-environments': 'Redefine center/flushright/flushleft sin espacio vertical extra',
  '22-toc-styling': 'Personaliza el indice (TOC): nombre, espaciado, fuentes y lideres',
  '23-toc-section': 'Redefine \\tableofcontents para usar \\section* en lugar de \\chapter*',
  '24-bibliography-heading': 'Cambia titulo de bibliografia de chapter a section',
  '25-hyphenation-rules': 'Agrega \\hyphenation{} con nombres propios de ejemplo',
};

export interface PreambleFilter {
  name: string;
  content: string;
}

export interface PreambleFilterInfo {
  name: string;
  description: string;
}

/**
 * Carga preamble filters desde el paquete y desde <cwd>/preamble/.
 * Los .tex del proyecto con el mismo nombre reemplazan a los del paquete.
 * @param disabledList Lista de filters a desactivar (blacklist). undefined = todos activos.
 * @param cwd Directorio del proyecto para buscar overrides.
 */
export async function loadPreambleFilters(disabledList?: string[], cwd?: string): Promise<PreambleFilter[]> {
  const excluded = new Set(disabledList ?? []);
  const result: PreambleFilter[] = [];

  for (const name of BUILTIN_PREAMBLE_FILTERS) {
    if (excluded.has(name)) continue;
    const projectPath = join(cwd ?? '', 'preamble', `${name}.tex`);
    const pkgPath = join(PKG_PREAMBLE_DIR, `${name}.tex`);
    const path = cwd && (await Bun.file(projectPath).exists()) ? projectPath : pkgPath;
    const content = await Bun.file(path).text();
    result.push({ name, content });
  }

  return result;
}

/** Retorna información de todos los preamble filters built-in. */
export function getBuiltinPreambleFilterInfos(): PreambleFilterInfo[] {
  return BUILTIN_PREAMBLE_FILTERS.map((name) => ({
    name,
    description: DESCRIPTIONS[name] ?? '',
  }));
}

/**
 * Valida los nombres de `disabled-preamble-filters` contra los preamble
 * filters built-in. Los nombres desconocidos emiten un warning sin romper
 * el build.
 */
export function validateDisabledPreambleFilters(disabled: string[] | undefined): void {
  if (!disabled || disabled.length === 0) return;
  for (const name of disabled) {
    if (BUILTIN_PREAMBLE_FILTERS.includes(name)) continue;
    logWarning(`disabled-preamble-filters: "${name}" no coincide con ningún preamble filter`, 'config');
  }
}
