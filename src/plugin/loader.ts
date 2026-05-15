import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IPlugin } from './types.js';

/**
 * Carga plugins ESM desde las rutas declaradas en `_iteraciones.yaml → plugins`.
 * Acepta rutas relativas al cwd del proyecto, rutas absolutas y paquetes npm.
 * El módulo debe exportar un `default` que sea un objeto con `name: string`.
 */
export async function loadPlugins(paths: string[], cwd: string): Promise<IPlugin[]> {
  const plugins: IPlugin[] = [];

  for (const specifier of paths) {
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

  return plugins;
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
