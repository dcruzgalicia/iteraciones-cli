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
// La lógica condicional real del proyecto vive en los filters del AST
// (src/builder/filters/), que sí requieren TypeScript.
// ---------------------------------------------------------------------------

/** Directorio de preamble filters del paquete. */
const PKG_PREAMBLE_DIR = join(import.meta.dir, '../lib/resources/preamble');

/** Lista de preamble filters empaquetados en orden de aplicación. */
export const BUILTIN_PREAMBLE_FILTERS: string[] = [
  '01-maketitle-patches',
  '02-environments',
  '03-toc-styling',
  '04-toc-section',
  '05-bibliography-heading',
  '06-hyphenation-rules',
];

const DESCRIPTIONS: Record<string, string> = {
  '01-maketitle-patches': 'Personaliza \\maketitle: 1+2 baselineskip, titulo en mayusculas',
  '02-environments': 'Redefine center/flushright/flushleft sin espacio vertical extra',
  '03-toc-styling': 'Personaliza el indice (TOC): nombre, espaciado, fuentes y lideres',
  '04-toc-section': 'Redefine \\tableofcontents para usar \\section* en lugar de \\chapter*',
  '05-bibliography-heading': 'Cambia titulo de bibliografia de chapter a section',
  '06-hyphenation-rules': 'Agrega \\hyphenation{} con nombres propios de ejemplo',
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
