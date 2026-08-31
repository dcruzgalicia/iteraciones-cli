import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { logWarning } from '../lib/logger.js';

const LUA_FILTERS_ROOT = join(import.meta.dir, '../lib/resources/filters');

const FLAGS_FILTER = join(LUA_FILTERS_ROOT, 'internal', 'flags.lua');

export const MBOX_HELPERS_FILTER = join(LUA_FILTERS_ROOT, 'latex', 'shared', 'mbox-helpers.lua');

const LUA_GROUPS: Array<{ dir: string; target: 'semantic' | 'latex' | 'html' }> = [
  { dir: 'semantic/string', target: 'semantic' },
  { dir: 'semantic/ast', target: 'semantic' },
  { dir: 'latex', target: 'latex' },
  { dir: 'html', target: 'html' },
];

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
      builtinNamesCache[groupDir] = [...new Bun.Glob('*.lua').scanSync({ cwd: join(LUA_FILTERS_ROOT, groupDir), onlyFiles: true })]
        .sort()
        .map((file) => file.replace(/\.lua$/, ''));
    }
  }
  return builtinNamesCache[dir] ?? [];
}

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

export async function loadFilterGroups(siteConfig: SiteConfig, disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const group = await resolveLuaFilters(disabledList, cwd);
  group.flags = [FLAGS_FILTER];
  group.user = cwd ? await resolveUserLuaFilters(cwd, siteConfig) : [];
  return group;
}

interface LuaFilterInfo {
  name: string;
  description: string;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

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
