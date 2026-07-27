import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError, PandocError } from '../lib/errors.js';
import { logError } from '../lib/logger.js';
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
    // Validar --concurrency
    const concurrency = options.concurrency;
    if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
      throw new Error(`--concurrency debe ser un entero positivo (recibido: "${concurrency}")`);
    }

    // Validar --output
    const output = options.outputDir;
    if (output !== undefined) {
      const normalized = normalize(output);
      if ((!isAbsolute(normalized) && normalized.startsWith('..')) || normalized === '/') {
        throw new Error(`--output no puede apuntar fuera del proyecto o a la raíz del sistema (recibido: "${output}")`);
      }
      if (isAbsolute(normalized)) {
        const projectRoot = normalize(cwd);
        if (projectRoot === normalized || projectRoot.startsWith(normalized + '/')) {
          throw new Error(`--output "${output}" es un directorio padre del proyecto; ejecutar clean() borraría los archivos fuente.`);
        }
      }
    }

    await build(cwd, options);
  } catch (err) {
    if (err instanceof PandocError) {
      const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
      logError(`${err.message}${location}`);
      if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    } else if (err instanceof ConfigError) {
      logError(err.message, 'config');
    } else if (err instanceof Error) {
      logError(err.message);
    } else {
      logError('Error desconocido al construir el sitio.');
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
      logError(err.message, 'config');
    } else if (err instanceof Error) {
      logError(err.message, 'info');
    } else {
      logError('Error desconocido al obtener información.');
    }
    process.exitCode = 1;
  }
}

export async function runInit(cwd: string): Promise<void> {
  try {
    await init(cwd);
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, 'init');
    } else {
      logError('Error desconocido al inicializar.');
    }
    process.exitCode = 1;
  }
}

export async function runValidate(cwd: string): Promise<void> {
  try {
    await validate(cwd);
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, 'validate');
    } else {
      logError('Error desconocido al validar.');
    }
    process.exitCode = 1;
  }
}

export async function runDoctor(cwd: string, options: { fix?: boolean } = {}): Promise<void> {
  try {
    await doctor(cwd, options);
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, 'doctor');
    } else {
      logError('Error desconocido al ejecutar doctor.');
    }
    process.exitCode = 1;
  }
}

export async function runNew(cwd: string, path: string): Promise<void> {
  try {
    const normalizedPath = path.endsWith('.md') ? path : `${path}.md`;

    if (isAbsolute(normalizedPath) || normalize(normalizedPath).startsWith('..')) {
      throw new Error(`la ruta debe ser relativa al directorio del proyecto (recibido: "${path}")`);
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
    logError(`al crear "${path}": ${err instanceof Error ? err.message : String(err)}`, 'new');
    process.exitCode = 1;
  }
}

export async function runTranspilers(cwd: string): Promise<void> {
  try {
    await transpilers(cwd);
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, 'transpilers');
    }
    process.exitCode = 1;
  }
}
