import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError, PandocError } from '../errors.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import { runDoctor as doctor } from './doctor.js';
import { runGraph as graph } from './graph.js';
import { runInit as init } from './init.js';
import { runNew as newDoc } from './new.js';
import { runTranspilers as transpilers } from './transpilers.js';
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

export async function runClean(cwd: string, options: { outputDir?: string } = {}): Promise<void> {
  const config = await loadSiteConfig(cwd).catch(() => null);
  const defaultDir = config?.format?.html?.generate ? 'dist/www' : 'dist/documents';
  const distDir = options.outputDir ?? join(cwd, defaultDir);
  const cacheDir = join(cwd, '.iteraciones');
  const label = defaultDir === 'dist/www' ? 'dist/www' : 'dist/documents';
  try {
    await rm(distDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    process.stdout.write(`clean: eliminados ${label} y .iteraciones\n`);
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
    const pandocOk = await checkPandoc()
      .then(() => true)
      .catch(() => false);
    const distLabel = config.format?.html?.generate ? 'dist/www' : 'dist/documents';
    const distExists = await stat(join(cwd, distLabel))
      .then((s) => s.isDirectory())
      .catch(() => false);

    process.stdout.write('info:\n');
    process.stdout.write(`  título:   ${config.title}\n`);
    process.stdout.write(`  tagline:  ${config.tagline}\n`);
    process.stdout.write(`  lang:     ${config.lang}\n`);
    process.stdout.write(`  pandoc:   ${pandocOk ? 'disponible' : 'no disponible'}\n`);
    process.stdout.write(`  ${distLabel}:  ${distExists ? 'generado' : 'no generado'}\n`);
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

export async function runNew(cwd: string, type: string, path: string, opts: { region?: string } = {}): Promise<void> {
  try {
    await newDoc(cwd, type, path, opts);
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error al crear documento: ${err.message}\n`);
    } else {
      process.stderr.write('Error desconocido al crear documento.\n');
    }
    process.exitCode = 1;
  }
}

export async function runTranspilers(cwd: string): Promise<void> {
  try {
    await transpilers(cwd);
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`Error: ${err.message}
`);
    }
    process.exitCode = 1;
  }
}

export async function runGraph(cwd: string, options: { output?: string } = {}): Promise<void> {
  try {
    await graph(cwd, options);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`Error de configuración: ${err.message}
`);
    } else if (err instanceof Error) {
      process.stderr.write(`Error al construir el grafo: ${err.message}
`);
    } else {
      process.stderr.write('Error desconocido al construir el grafo.\n');
    }
    process.exitCode = 1;
  }
}
