import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import { IGNORED_DIRS } from '../builder/discover.js';
import { isHiddenPath, isIgnoredByRules, loadGitignoreRules } from '../builder/gitignore.js';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { computeActiveFormats } from '../config/site-config.js';
import { ConfigError, PandocError } from '../lib/errors.js';
import { logError, logInfo, logSuccess } from '../lib/logger.js';
import { checkPandoc } from '../lib/pandoc-runner.js';
import { runDoctor as doctor } from './doctor.js';
import { runFilters as filters } from './filters.js';
import { runInit as init } from './init.js';
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
  logSuccess('eliminado dist/ y .iteraciones/', 'clean');
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
          throw new Error(`--output "${output}" apunta a un directorio padre del proyecto, lo que podría sobrescribir los archivos fuente.`);
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
    const pandocVersion = await checkPandoc().catch(() => 'no disponible');
    const distDir = join(cwd, 'dist', 'files');
    const distExists = await stat(distDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    const activeFormats = computeActiveFormats(config.format);
    const disabledList = config.disabledFilters?.length ? config.disabledFilters.join(', ') : '(todos activos)';
    const disabledPreamble = config.disabledPreambleFilters?.length ? config.disabledPreambleFilters.join(', ') : '(todos activos)';
    const docCount = await countMarkdownDocuments(cwd);
    const html = config.format?.html;
    const theme = html?.theme ?? '(por defecto)';
    const accent = html?.accent ?? '(por defecto)';

    const lines = [
      `  lang:                    ${config.lang}`,
      `  documentos:              ${docCount}`,
      `  salida:                  ${distDir}${distExists ? ' (generado)' : ' (no generado)'}`,
      `  pandoc:                  ${pandocVersion}`,
      `  formatos activos:        ${activeFormats.length > 0 ? activeFormats.join(', ') : '(ninguno)'}`,
      `  tema HTML:               ${theme}`,
      `  acento HTML:             ${accent}`,
      `  filters desactivados:    ${disabledList}`,
      `  preamble desactivados:   ${disabledPreamble}`,
    ];
    logInfo(lines.join('\n'), 'info');
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

/** Cuenta los documentos Markdown del proyecto, excluyendo directorios ignorados. */
async function countMarkdownDocuments(cwd: string): Promise<number> {
  let count = 0;
  const gitignoreRules = await loadGitignoreRules(cwd);
  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    if (isIgnoredByRules(entry, gitignoreRules)) continue;
    if (isHiddenPath(entry)) continue;
    count++;
  }
  return count;
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

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const title = inferTitleFromPath(normalizedPath);
    const content = `---\ntitle: '${title}'\ndate: ${today}\n---\n\nEscribe tu contenido aquí.\n`;

    await writeFile(absPath, content, { encoding: 'utf8', flag: 'wx' });
    logSuccess(`creado ${normalizedPath}`, 'new');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      logInfo(`omitido ${path} (ya existe)`, 'new');
      return;
    }
    logError(`al crear "${path}": ${err instanceof Error ? err.message : String(err)}`, 'new');
    process.exitCode = 1;
  }
}

export async function runFilters(cwd: string): Promise<void> {
  try {
    await filters(cwd);
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, 'filters');
    }
    process.exitCode = 1;
  }
}

/**
 * Infiere un título legible desde la ruta del archivo: elimina la extensión
 * .md, reemplaza guiones y guiones bajos por espacios, y capitaliza la
 * primera letra de cada palabra. Ej: `posts/mi-articulo` → `Mi Articulo`.
 */
function inferTitleFromPath(path: string): string {
  const base = basename(path, '.md').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Título del documento';
  // Capitalizar solo la primera letra
  return base.charAt(0).toUpperCase() + base.slice(1);
}
