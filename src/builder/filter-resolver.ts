import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { ConfigError } from '../lib/errors.js';
import { isDir } from '../lib/paths.js';
import { DESCRIPCIONES_LUA } from './filter-descriptions.js';

export const LUA_FILTERS_ROOT = join(import.meta.dir, '../lib/resources/filters');

const FLAGS_FILTER = join(LUA_FILTERS_ROOT, 'internal', 'flags.lua');

export const MBOX_HELPERS_FILTER = join(LUA_FILTERS_ROOT, 'latex', 'shared', 'mbox-helpers.lua');

export const STRIP_TYPOGRAPHIC_FILTER = join(LUA_FILTERS_ROOT, 'internal', 'strip-typographic.lua');

const LUA_GROUPS: Array<{ dir: string; target: 'semantic' | 'latex' | 'html' }> = [
  { dir: 'semantic/ast', target: 'semantic' },
  { dir: 'latex', target: 'latex' },
  { dir: 'html', target: 'html' },
];

/** El orden de ejecución dentro de un grupo: el número del nombre manda. */
function compareFilterNames(dir: string, a: string, b: string): number {
  if (dir === 'latex') {
    // 16-runt necesita ir antes de los filtros de textls (14 y 15).
    const textls = new Set(['14-shrink', '15-stretch']);
    if (a === '16-runt' && textls.has(b)) return -1;
    if (textls.has(a) && b === '16-runt') return 1;
  }
  return a.localeCompare(b);
}

/**
 * El grupo que declara la ruta de un filtro del proyecto, si la nombra: en
 * `filters/latex/99-algo.lua` el grupo es `latex`, así que el filtro sólo se
 * aplica a ese formato. Sin grupo, el filtro es global (todos los formatos).
 */
export function groupOfFilterPath(rel: string): { group: string; name: string } | undefined {
  const partes = rel
    .replace(/\\/g, '/')
    .replace(/\.lua$/i, '')
    .split('/')
    .filter((parte) => parte !== '' && parte !== '.');
  const name = partes.at(-1);
  if (name === undefined) return undefined;
  const dir = partes.slice(0, -1).join('/');
  const group = LUA_GROUPS.map((g) => g.dir).find((g) => dir === g || dir.endsWith(`/${g}`));
  return group === undefined ? undefined : { group, name };
}

export const LUA_GROUP_ORDER = LUA_GROUPS.map((g) => g.dir);

export interface LuaFilterGroup {
  semantic: string[];
  latex: string[];
  html: string[];
  flags: string[];
  user: string[];
  resolvedNames: Set<string>;
}

async function resolveLuaFilter(group: string, name: string, cwd?: string): Promise<string | undefined> {
  if (cwd) {
    const projectPath = join(cwd, 'filters', group, `${name}.lua`);
    if (await Bun.file(projectPath).exists()) return projectPath;
  }
  const pkgPath = join(LUA_FILTERS_ROOT, group, `${name}.lua`);
  return (await Bun.file(pkgPath).exists()) ? pkgPath : undefined;
}

let builtinNamesCache: Record<string, string[]> | null = null;

function builtinNamesForGroup(dir: string): string[] {
  if (builtinNamesCache === null) {
    builtinNamesCache = {};
    for (const { dir: groupDir } of LUA_GROUPS) {
      const names = [...new Bun.Glob('*.lua').scanSync({ cwd: join(LUA_FILTERS_ROOT, groupDir), onlyFiles: true })].map((file) =>
        file.replace(/\.lua$/, ''),
      );
      names.sort((a, b) => compareFilterNames(groupDir, a, b));
      builtinNamesCache[groupDir] = names;
    }
  }
  return builtinNamesCache[dir] ?? [];
}

/** Los filtros del proyecto que declaran grupo en la ruta, por grupo y nombre. */
async function projectGroupFilters(cwd: string | undefined, configFilters: string[] | undefined): Promise<Map<string, Map<string, string>>> {
  const porGrupo = new Map<string, Map<string, string>>();
  for (const rel of configFilters ?? []) {
    const conGrupo = groupOfFilterPath(rel);
    if (conGrupo === undefined) continue;
    const abs = join(cwd ?? '', rel);
    if (!(await Bun.file(abs).exists())) continue;
    const nombres = porGrupo.get(conGrupo.group) ?? new Map<string, string>();
    nombres.set(conGrupo.name, abs);
    porGrupo.set(conGrupo.group, nombres);
  }
  return porGrupo;
}

/** Los filtros de un grupo por nombre: los del paquete y, encima, los del proyecto. */
async function groupEntries(
  dir: string,
  excluded: Set<string>,
  cwd: string | undefined,
  extras: Map<string, Map<string, string>>,
): Promise<Map<string, string>> {
  const porNombre = new Map<string, string>();
  for (const name of builtinNamesForGroup(dir)) {
    if (excluded.has(`${dir}/${name}`)) continue;
    const path = await resolveLuaFilter(dir, name, cwd);
    if (path !== undefined) porNombre.set(name, path);
  }
  // Un filtro del proyecto con grupo manda: si se llama igual que uno del
  // paquete lo sobrescribe y, si no, se suma en el orden de su número.
  for (const [name, path] of extras.get(dir) ?? []) {
    if (!excluded.has(`${dir}/${name}`)) porNombre.set(name, path);
  }
  return porNombre;
}

export async function resolveLuaFilters(disabledList?: string[], cwd?: string, configFilters?: string[]): Promise<LuaFilterGroup> {
  const excluded = new Set(disabledList ?? []);
  const result: LuaFilterGroup = { semantic: [], latex: [], html: [], flags: [], user: [], resolvedNames: new Set() };
  const extras = await projectGroupFilters(cwd, configFilters);

  for (const { dir, target } of LUA_GROUPS) {
    const porNombre = await groupEntries(dir, excluded, cwd, extras);
    for (const [name, path] of [...porNombre].sort(([a], [b]) => compareFilterNames(dir, a, b))) {
      result[target].push(path);
      result.resolvedNames.add(`${dir}/${name}`);
    }
  }

  return result;
}

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

export function suggestFilterName(name: string): string | undefined {
  return getBuiltinFilterNames().find((n) => n.endsWith(`/${name}`));
}

/** Los nombres `grupo/nombre` de los filtros que el proyecto declara. */
export function projectFilterNames(configFilters: string[] | undefined): string[] {
  const nombres: string[] = [];
  for (const rel of configFilters ?? []) {
    const conGrupo = groupOfFilterPath(rel);
    if (conGrupo !== undefined) nombres.push(`${conGrupo.group}/${conGrupo.name}`);
  }
  return nombres;
}

export function validateDisabledFilters(disabled: string[] | undefined, configPath: string, projectFilters: string[] = []): void {
  if (!disabled || disabled.length === 0) return;
  const conocidos = new Set([...getBuiltinFilterNames(), ...projectFilters]);
  const desconocidos: string[] = [];
  for (const name of disabled) {
    if (conocidos.has(name)) continue;
    const suggestion = suggestFilterName(name);
    desconocidos.push(suggestion ? `"${name}" no existe; ¿quisiste decir "${suggestion}"?` : `"${name}" no coincide con ningún filter`);
  }
  if (desconocidos.length > 0) {
    throw new ConfigError(`disabledFilters: ${desconocidos.join('; ')}`, configPath);
  }
}

export async function resolveUserLuaFilters(cwd: string, siteConfig: SiteConfig): Promise<string[]> {
  const resolved: string[] = [];
  for (const rel of siteConfig.luaFilters ?? []) {
    // Los que declaran grupo ya entraron en su capa, no se repiten como globales.
    if (groupOfFilterPath(rel) !== undefined) continue;
    const abs = join(cwd, rel);
    if (await Bun.file(abs).exists()) resolved.push(abs);
  }
  return resolved;
}

export async function loadFilterGroups(siteConfig: SiteConfig, disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const group = await resolveLuaFilters(disabledList, cwd, siteConfig.luaFilters);
  group.flags = [FLAGS_FILTER];
  group.user = cwd ? await resolveUserLuaFilters(cwd, siteConfig) : [];
  return group;
}

interface LuaFilterInfo {
  name: string;
  description: string;
}

export async function getBuiltinLuaFilterInfos(): Promise<LuaFilterInfo[]> {
  const infos: LuaFilterInfo[] = [];
  if (!(await isDir(LUA_FILTERS_ROOT))) return infos;
  const glob = new Bun.Glob('**/*.lua');
  for await (const rel of glob.scan({ cwd: LUA_FILTERS_ROOT, onlyFiles: true })) {
    if (rel.startsWith('internal/') || rel.includes('/shared/')) continue;
    const group = dirname(rel);
    const full = `${group}/${basename(rel, '.lua')}`;
    infos.push({ name: full, description: DESCRIPCIONES_LUA[full] ?? '' });
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}
