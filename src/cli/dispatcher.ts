import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError, PandocError } from '../errors.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import { runServe as serve } from './serve.js';

export async function runBuild(cwd: string, options: BuildOptions = {}): Promise<void> {
  try {
    await build(cwd, options);
  } catch (err) {
    if (err instanceof PandocError) {
      const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
      process.stderr.write(`Error de pandoc${location}: ${err.message}\n`);
      if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    } else if (err instanceof ConfigError) {
      process.stderr.write(`Error de configuración en "${err.configPath}": ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido durante el build.\n');
    }
    // Asignar exitCode en lugar de llamar process.exit() directamente permite
    // que el event loop drene los streams antes de que el proceso termine.
    process.exitCode = 1;
  }
}

// stub: implementado en issue #60
export async function runClean(cwd: string): Promise<void> {
  try {
    const targets = [join(cwd, 'dist/web'), join(cwd, '.iteraciones/cache')];
    for (const dir of targets) {
      try {
        await stat(dir);
        await rm(dir, { recursive: true, force: true });
        process.stdout.write(`Eliminado: ${dir}\n`);
      } catch (statErr: unknown) {
        // El directorio no existe; no hay nada que limpiar.
        if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr;
      }
    }
    process.stdout.write('Limpieza completada.\n');
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error al limpiar: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al limpiar.\n');
    }
    process.exitCode = 1;
  }
}

// stub: implementado en issue #60
export async function runInfo(cwd: string): Promise<void> {
  try {
    const [siteConfig, pandocVersion] = await Promise.all([loadSiteConfig(cwd), checkPandoc()]);
    const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);
    let docCount = 0;
    for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
      const first = entry.split('/')[0];
      if (first && IGNORED_DIRS.has(first)) continue;
      docCount++;
    }
    const plugins = siteConfig.plugins.length > 0 ? siteConfig.plugins.join(', ') : 'ninguno';
    process.stdout.write(`Proyecto  : ${cwd}\n`);
    process.stdout.write(`Sitio     : ${siteConfig.title}\n`);
    process.stdout.write(`Tagline   : ${siteConfig.tagline}\n`);
    process.stdout.write(`Idioma    : ${siteConfig.lang}\n`);
    process.stdout.write(`Plugins   : ${plugins}\n`);
    process.stdout.write(`Pandoc    : ${pandocVersion}\n`);
    process.stdout.write(`Documentos: ${docCount}\n`);
    process.stdout.write(`Salida    : ${join(cwd, 'dist/web')}\n`);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`Error de configuración en "${err.configPath}": ${err.message}\n`);
    } else if (err instanceof PandocError) {
      process.stderr.write(`Error de pandoc: ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al obtener información.\n');
    }
    process.exitCode = 1;
  }
}

export async function runServe(cwd: string, port: number): Promise<void> {
  try {
    const stop = await serve(cwd, port);
    // Mantener el proceso activo hasta recibir señal de terminación.
    const shutdown = (): void => {
      stop();
      process.exitCode = 0;
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al arrancar el servidor.\n');
    }
    process.exitCode = 1;
  }
}
