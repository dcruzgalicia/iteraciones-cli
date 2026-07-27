import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError, PandocError } from '../lib/errors.js';
import { checkPandoc } from '../lib/pandoc-runner.js';
import { runDoctor as doctor } from './doctor.js';
import { runInit as init } from './init.js';
import { runTranspilers as transpilers } from './transpilers.js';
import { runValidate as validate } from './validate.js';

export async function runClean(cwd: string): Promise<void> {
  const targets = [join(cwd, 'dist'), join(cwd, '.iteraciones')];
  await Promise.all(
    targets.map((dir) =>
      rm(dir, { recursive: true, force: true }).catch(() => {
        // ignorar errores de directorios que no existen
      }),
    ),
  );
  process.stdout.write('clean: eliminado dist/ y .iteraciones/\n');
}

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

export async function runInfo(cwd: string): Promise<void> {
  try {
    const config = await loadSiteConfig(cwd);
    const pandocOk = await checkPandoc()
      .then(() => true)
      .catch(() => false);
    const distLabel = 'dist/files';
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

export async function runNew(cwd: string, path: string): Promise<void> {
  try {
    const normalizedPath = path.endsWith('.md') ? path : `${path}.md`;

    if (isAbsolute(normalizedPath) || normalize(normalizedPath).startsWith('..')) {
      process.stderr.write(`Error: la ruta debe ser relativa al directorio del proyecto (recibido: "${path}")\n`);
      process.exitCode = 1;
      return;
    }

    const absPath = join(cwd, normalizedPath);
    await mkdir(dirname(absPath), { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const content = `---\ntitle: ''\ndate: ${today}\n---\n\n`;

    await writeFile(absPath, content, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`new: creado ${normalizedPath}\n`);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      process.stdout.write(`new: omitido ${path} (ya existe)\n`);
      return;
    }
    process.stderr.write(`Error al crear "${path}": ${err instanceof Error ? err.message : String(err)}\n`);
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
