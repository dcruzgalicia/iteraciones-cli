import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { logWarning } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Sistema de filters por capas: filtros Lua que corren dentro de pandoc.
//   semantic/string y semantic/ast: en cada conversión, sobre el markdown
//     de entrada (dejan el contenido semántico sin formato específico).
//   internal/flags: filtro interno de detección estructural (preámbulo LaTeX
//     y heading de referencias HTML); no es un filter de usuario.
//   latex/ y html/: en cada exportación (markdown → latex, markdown → html5).
//
// Pipeline:
//   markdown → pandoc --to latex [--lua-filter semantic/*, user, flags, latex/*]
//            → pandoc --to html5 [--lua-filter semantic/*, user, flags, html/*]
//            → pandoc --to epub3/markdown [--lua-filter semantic/*, user]
//   No hay AST intermedio: cada conversión es una invocación directa de pandoc
//   desde el markdown original, con el template efectivo compuesto por el CLI.
// ---------------------------------------------------------------------------

/** Raíz de los filtros Lua del paquete. */
const LUA_FILTERS_ROOT = join(import.meta.dir, '../lib/resources/filters');

/** Filtro interno de detección estructural (flags de preámbulo y referencias). */
const FLAGS_FILTER = join(LUA_FILTERS_ROOT, 'internal', 'flags.lua');

/**
 * Helpers compartidos de la capa latex (mbox-helpers). No es un filter ni se
 * pasa como --lua-filter (pandoc aísla el estado Lua de cada filtro): el
 * pipeline inyecta su ruta absoluta como variable de entorno
 * ITERACIONES_MBOX_HELPERS en las invocaciones markdown → latex, y los
 * filtros 06/07 la cargan con dofile. Sin el env (ejecución suelta, tests),
 * usan el require relativo a PANDOC_SCRIPT_FILE, que funciona para los
 * filters del paquete pero no para overrides del proyecto.
 */
export const MBOX_HELPERS_FILTER = join(LUA_FILTERS_ROOT, 'latex', 'shared', 'mbox-helpers.lua');

/** Capas de filtros Lua del paquete: directorio → grupo de resolución. */
const LUA_GROUPS: Array<{ dir: string; target: 'semantic' | 'latex' | 'html' }> = [
  { dir: 'semantic/string', target: 'semantic' },
  { dir: 'semantic/ast', target: 'semantic' },
  { dir: 'latex', target: 'latex' },
  { dir: 'html', target: 'html' },
];

/**
 * Orden de ejecución real de los grupos de filtros Lua. Fuente única: deriva
 * de LUA_GROUPS (el CLI lo consume para ordenar la salida de `iteraciones
 * filters`; antes se duplicaba en cli/filters.ts).
 */
export const LUA_GROUP_ORDER = LUA_GROUPS.map((g) => g.dir);

/** Filtros Lua resueltos por capa (rutas absolutas, en orden de aplicación). */
export interface LuaFilterGroup {
  semantic: string[];
  latex: string[];
  html: string[];
  /** Filtro interno de detección estructural (flags), en pasadas latex/html. */
  flags: string[];
  /** Filtros Lua de usuario (`lua-filters:` del proyecto), corren en todas las invocaciones. */
  user: string[];
  /** Nombres completos resueltos como .lua (los .ts equivalentes se omiten). */
  resolvedNames: Set<string>;
}

/** Resuelve el .lua de un filter: override del proyecto gana sobre el paquete. */
async function resolveLuaFilter(group: string, name: string, cwd?: string): Promise<string | undefined> {
  if (cwd) {
    const projectPath = join(cwd, 'filters', group, `${name}.lua`);
    if (await Bun.file(projectPath).exists()) return projectPath;
  }
  const pkgPath = join(LUA_FILTERS_ROOT, group, `${name}.lua`);
  return (await Bun.file(pkgPath).exists()) ? pkgPath : undefined;
}

/**
 * Nombres de los .lua de una capa del paquete, en orden de aplicación
 * (el prefijo numérico del archivo define el orden). Derivado del
 * filesystem: crear un .lua nuevo no requiere tocar código. El escaneo se
 * memoiza por proceso (los recursos no cambian durante un build; antes se
 * escaneaba el disco en cada llamada, 2-4 veces por build).
 */
let builtinNamesCache: Record<string, string[]> | null = null;

function builtinNamesForGroup(dir: string): string[] {
  if (builtinNamesCache === null) {
    builtinNamesCache = {};
    for (const { dir: groupDir } of LUA_GROUPS) {
      builtinNamesCache[groupDir] = [...new Bun.Glob('*.lua').scanSync({ cwd: join(LUA_FILTERS_ROOT, groupDir), onlyFiles: true })]
        .sort()
        .map((file) => file.replace(/\.lua$/, ''));
    }
  }
  return builtinNamesCache[dir] ?? [];
}

/**
 * Resuelve los filtros Lua por capa: los nombres con un .lua disponible
 * (paquete o override del proyecto) se pasan como `--lua-filter` en la
 * invocación pandoc de su capa.
 */
export async function resolveLuaFilters(disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const excluded = new Set(disabledList ?? []);
  const result: LuaFilterGroup = { semantic: [], latex: [], html: [], flags: [], user: [], resolvedNames: new Set() };

  for (const { dir, target } of LUA_GROUPS) {
    for (const name of builtinNamesForGroup(dir)) {
      const full = `${dir}/${name}`;
      if (excluded.has(full)) continue;
      const path = await resolveLuaFilter(dir, name, cwd);
      if (!path) continue;
      result[target].push(path);
      result.resolvedNames.add(full);
    }
  }
  return result;
}

/** Nombres completos (grupo/nombre) de todos los filters built-in del paquete. */
let builtinFilterNamesCache: string[] | null = null;

export function getBuiltinFilterNames(): string[] {
  if (builtinFilterNamesCache === null) {
    const names: string[] = [];
    for (const { dir } of LUA_GROUPS) {
      for (const name of builtinNamesForGroup(dir)) {
        names.push(`${dir}/${name}`);
      }
    }
    builtinFilterNamesCache = names.sort();
  }
  return builtinFilterNamesCache;
}

/** Sugiere el nombre completo de un filter a partir de un nombre incompleto. */
export function suggestFilterName(name: string): string | undefined {
  return getBuiltinFilterNames().find((n) => n.endsWith(`/${name}`));
}

/**
 * Valida los nombres de `disabled-filters` contra los filters built-in.
 * Los nombres desconocidos (p. ej. configs con nombres incompletos) emiten un
 * warning con la sugerencia, sin romper el build.
 */
export function validateDisabledFilters(disabled: string[] | undefined): void {
  if (!disabled || disabled.length === 0) return;
  for (const name of disabled) {
    if (getBuiltinFilterNames().includes(name)) continue;
    const suggestion = suggestFilterName(name);
    logWarning(
      suggestion
        ? `disabled-filters: "${name}" no existe; ¿quisiste decir "${suggestion}"?`
        : `disabled-filters: "${name}" no coincide con ningún filter`,
      'config',
    );
  }
}

/**
 * Resuelve los filtros Lua de usuario (`lua-filters:` en iteraciones.config.yaml,
 * rutas relativas al proyecto). Las rutas inexistentes se omiten sin romper el
 * build; el warning lo emite `validateConfigFilePaths` (fuente única de
 * reporte de problemas de configuración, compartida por build y validate).
 */
export async function resolveUserLuaFilters(cwd: string, siteConfig: SiteConfig): Promise<string[]> {
  const filters = siteConfig.luaFilters ?? [];
  const resolved: string[] = [];
  for (const rel of filters) {
    const abs = join(cwd, rel);
    if (await Bun.file(abs).exists()) {
      resolved.push(abs);
    }
  }
  return resolved;
}

/**
 * Resuelve los filtros Lua por capa, incluyendo el filtro interno de flags
 * y los filtros de usuario (`lua-filters:`), que corren en todas las
 * invocaciones.
 */
export async function loadFilterGroups(siteConfig: SiteConfig, disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const group = await resolveLuaFilters(disabledList, cwd);
  group.flags = [FLAGS_FILTER];
  group.user = cwd ? await resolveUserLuaFilters(cwd, siteConfig) : [];
  return group;
}

/** Información de un filtro Lua built-in para el CLI. */
export interface LuaFilterInfo {
  name: string;
  description: string;
}

/** Retorna true si la ruta es un directorio existente. */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Escanea los filtros Lua built-in del paquete (`lib/resources/filters`).
 * El directorio internal/ (filtros del pipeline, no de usuario) y los módulos
 * compartidos de una capa (shared/) se excluyen.
 * La descripción se toma de la primera línea de comentario `-- ...` del archivo.
 */
export async function getBuiltinLuaFilterInfos(): Promise<LuaFilterInfo[]> {
  const infos: LuaFilterInfo[] = [];
  if (!(await dirExists(LUA_FILTERS_ROOT))) return infos;
  const glob = new Bun.Glob('**/*.lua');
  for await (const rel of glob.scan({ cwd: LUA_FILTERS_ROOT, onlyFiles: true })) {
    if (rel.startsWith('internal/') || rel.includes('/shared/')) continue;
    const group = dirname(rel);
    const full = `${group}/${basename(rel, '.lua')}`;
    const content = await Bun.file(join(LUA_FILTERS_ROOT, rel)).text();
    infos.push({ name: full, description: readLuaDescription(content) });
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lee la descripción de un filter Lua: une las líneas de comentario iniciales
 * (`-- ...`) en una sola frase. Se detiene en la primera línea de código o en
 * una línea de "Uso: ..." (instrucciones de invocación, no descripción).
 */
function readLuaDescription(content: string): string {
  const lines: string[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('--')) {
      const text = line.replace(/^--\s*/, '').trim();
      if (text.startsWith('Uso:')) break;
      lines.push(text);
    } else if (lines.length > 0) {
      break;
    }
  }
  return lines.join(' ');
}
