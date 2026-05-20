import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IPlugin } from './types.js';

export type LoadPluginsResult = {
  /** Plugins ESM (TS/JS) cargados y listos para registrar. */
  plugins: IPlugin[];
  /** Rutas absolutas a filtros Lua declarados en el array `plugins:` de la config. */
  luaFilters: string[];
};

/**
 * Carga plugins ESM desde las rutas declaradas en `_iteraciones.yaml → plugins`.
 * Acepta rutas relativas al cwd del proyecto, rutas absolutas y paquetes npm.
 * El módulo debe exportar un `default` que sea un objeto con `name: string`.
 *
 * Las entradas que terminan en `.lua` se tratan como filtros Pandoc Lua:
 * se resuelven a rutas absolutas y se retornan en `luaFilters` sin intentar
 * importarlas como módulos.
 */
export async function loadPlugins(paths: string[], cwd: string): Promise<LoadPluginsResult> {
  const plugins: IPlugin[] = [];
  const luaFilters: string[] = [];

  for (const specifier of paths) {
    if (specifier.endsWith('.lua')) {
      luaFilters.push(resolveLuaFilter(specifier, cwd));
      continue;
    }

    const resolved = resolveSpecifier(specifier, cwd);

    let mod: { default?: unknown };
    try {
      mod = (await import(resolved)) as { default?: unknown };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Error al cargar el plugin "${specifier}": ${message}`);
    }

    const plugin = mod.default;
    if (!plugin || typeof plugin !== 'object' || typeof (plugin as Record<string, unknown>).name !== 'string') {
      throw new Error(`El plugin "${specifier}" no exporta un objeto válido con la propiedad \`name\` de tipo string como default.`);
    }

    plugins.push(plugin as IPlugin);
  }

  return { plugins, luaFilters };
}

function resolveSpecifier(specifier: string, cwd: string): string {
  // Rutas relativas o absolutas al sistema de archivos → file:// URL
  if (specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier)) {
    const absolutePath = isAbsolute(specifier) ? specifier : resolve(cwd, specifier);
    return pathToFileURL(absolutePath).href;
  }
  // Paquetes npm u otros especificadores (se pasan directamente a import())
  return specifier;
}

function resolveLuaFilter(specifier: string, cwd: string): string {
  if (isAbsolute(specifier)) return specifier;
  if (specifier.startsWith('./') || specifier.startsWith('../')) return resolve(cwd, specifier);
  // Nombre simple sin ruta relativa: se busca relativo al cwd
  return resolve(cwd, specifier);
}
