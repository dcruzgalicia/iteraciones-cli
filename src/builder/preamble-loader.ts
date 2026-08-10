import { join } from 'node:path';
import { BuildError } from '../lib/errors.js';

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

/**
 * Nombres de los preamble filters del paquete, en orden de aplicación
 * (el prefijo numérico del archivo define el orden). Derivado del
 * filesystem: crear un .tex nuevo no requiere tocar código.
 */
export function getBuiltinPreambleFilterNames(): string[] {
  return [...new Bun.Glob('*.tex').scanSync({ cwd: PKG_PREAMBLE_DIR, onlyFiles: true })].sort().map((file) => file.replace(/\.tex$/, ''));
}

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

  for (const name of getBuiltinPreambleFilterNames()) {
    if (excluded.has(name)) continue;
    const projectPath = join(cwd ?? '', 'preamble', `${name}.tex`);
    const pkgPath = join(PKG_PREAMBLE_DIR, `${name}.tex`);
    const path = cwd && (await Bun.file(projectPath).exists()) ? projectPath : pkgPath;
    const content = await Bun.file(path).text();
    result.push({ name, content });
  }

  return result;
}

/** Retorna información de todos los preamble filters built-in (descripción de la primera línea %). */
export async function getBuiltinPreambleFilterInfos(): Promise<PreambleFilterInfo[]> {
  const infos: PreambleFilterInfo[] = [];
  for (const name of getBuiltinPreambleFilterNames()) {
    const content = await Bun.file(join(PKG_PREAMBLE_DIR, `${name}.tex`)).text();
    const descLine = content.split('\n').find((line) => line.trim().startsWith('%'));
    infos.push({ name, description: descLine?.replace(/^%\s*/, '').trim() ?? '' });
  }
  return infos;
}

/**
 * Valida los nombres de `disabled-preamble-filters` contra los preamble
 * filters built-in. Un nombre desconocido es un error bloqueante: el usuario
 * cree que desactivó un filtro que sigue activo (p. ej. marcas de corte en un
 * PDF digital), así que el build no puede continuar silenciosamente.
 */
export function validateDisabledPreambleFilters(disabled: string[] | undefined): void {
  if (!disabled || disabled.length === 0) return;
  const unknown: string[] = [];
  for (const name of disabled) {
    if (!getBuiltinPreambleFilterNames().includes(name)) unknown.push(name);
  }
  if (unknown.length > 0) {
    throw new BuildError(`disabled-preamble-filters: "${unknown.join(', ')}" no coincide con ningún preamble filter`);
  }
}
