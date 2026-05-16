import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError, PandocError } from '../errors.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import { runDoctor as doctor } from './doctor.js';
import { runInit as init } from './init.js';
import { runServe as serve } from './serve.js';
import { runValidate as validate } from './validate.js';
import { runWatch as watch } from './watch.js';

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
      process.stderr.write('Error desconocido al construir el sitio.\n');
    }
    process.exitCode = 1;
  }
}

export async function runClean(cwd: string): Promise<void> {
  const distDir = join(cwd, 'dist', 'web');
  const cacheDir = join(cwd, '.iteraciones');
  try {
    await rm(distDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    process.stdout.write('clean: eliminados dist/web y .iteraciones\n');
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error al limpiar: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al limpiar.\n');
    }
    process.exitCode = 1;
  }
}

export async function runInfo(cwd: string): Promise<void> {
  try {
    const config = await loadSiteConfig(cwd);
    const pandocOk = await checkPandoc().then(() => true).catch(() => false);
    const distExists = await stat(join(cwd, 'dist', 'web')).then((s) => s.isDirectory()).catch(() => false);

    process.stdout.write('info:\n');
    process.stdout.write(`  título:   ${config.title}\n`);
    process.stdout.write(`  tagline:  ${config.tagline}\n`);
    process.stdout.write(`  lang:     ${config.lang}\n`);
    process.stdout.write(`  pandoc:   ${pandocOk ? 'disponible' : 'no disponible'}\n`);
    process.stdout.write(`  dist:     ${distExists ? 'generado' : 'no generado'}\n`);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`Error de configuración: ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`Error al obtener información: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al obtener información.\n');
    }
    process.exitCode = 1;
  }
}

export async function runInit(cwd: string): Promise<void> {
  try {
    await init(cwd);
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error al inicializar: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al inicializar.\n');
    }
    process.exitCode = 1;
  }
}

export async function runValidate(cwd: string): Promise<void> {
  try {
    await validate(cwd);
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error al validar: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al validar.\n');
    }
    process.exitCode = 1;
  }
}

export async function runWatch(cwd: string, options: { verbose?: boolean } = {}): Promise<() => void> {
  try {
    return await watch(cwd, options);
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
      process.stderr.write('Error desconocido al arrancar watch.\n');
    }
    process.exitCode = 1;
    return () => undefined;
  }
}

export async function runDoctor(cwd: string, options: { fix?: boolean } = {}): Promise<void> {
  try {
    await doctor(cwd, options);
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error al ejecutar doctor: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al ejecutar doctor.\n');
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
    if (err instanceof PandocError) {
      const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
      process.stderr.write(`Error de pandoc${location}: ${err.message}\n`);
      if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    } else if (err instanceof ConfigError) {
      process.stderr.write(`Error de configuración en "${err.configPath}": ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al arrancar el servidor.\n');
    }
    process.exitCode = 1;
  }
}
