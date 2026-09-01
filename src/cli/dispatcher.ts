import { exists, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { stringify } from 'yaml';
import { listMarkdownDocuments } from '../builder/discover-files.js';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { DIST_DIR, DIST_FILES_DIR } from '../builder/output-layout.js';
import { loadStateFile } from '../builder/state-serialize.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { computeActiveFormats, DEFAULT_PDF_FORMAT } from '../config/site-config.js';
import { BUILD_ERROR_CODES, BuildError, ConfigError, ConversionError, PANDOC_ERROR_CODES } from '../lib/errors.js';
import { logError, logInfo, logSuccess } from '../lib/logger.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { ProcessSpawnError } from '../lib/run.js';
import type { CheckResult } from './doctor/system-checks.js';
import { collectChecks, doctorEnvironment } from './doctor.js';
import { listFilters, type RunFiltersOptions } from './filters.js';
import { initProject } from './init.js';
import { ProgressTracker } from './progress.js';
import { validateProject } from './validate.js';

async function assertProjectRoot(cwd: string): Promise<void> {
  try {
    const st = await stat(cwd);
    if (!st.isDirectory()) throw new Error(`"${cwd}" no es un directorio`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`el directorio "${cwd}" no existe`);
    }
    throw err;
  }
}

async function runCliCommand(
  cwd: string,
  context: string,
  fn: () => Promise<void>,
  unknownMessage: string,
  options: { createRoot?: boolean } = {},
): Promise<void> {
  try {
    if (options.createRoot) {
      const existed = await exists(cwd);
      await mkdir(cwd, { recursive: true });
      if (!existed) logInfo(`creado el directorio "${cwd}"`, context);
    } else {
      await assertProjectRoot(cwd);
    }
    await fn();
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, context);
    } else {
      logError(unknownMessage, context);
    }
    process.exitCode = 1;
  }
}

export async function runClean(cwd: string, options: { json?: boolean } = {}): Promise<void> {
  await runCliCommand(
    cwd,
    'clean',
    async () => {
      const state = await loadStateFile(cwd);
      const outputDir = state?.outputDir ?? join(cwd, DIST_DIR);
      const targets = [...new Set([outputDir, join(cwd, '.iteraciones')])];
      const results = await Promise.all(
        targets.map(async (dir) => {
          try {
            const existed = await exists(dir);
            await rm(dir, { recursive: true, force: true });
            return { removed: existed ? dir : null, error: null };
          } catch (err) {
            return { removed: null, error: `${dir}: ${err instanceof Error ? err.message : String(err)}` };
          }
        }),
      );
      const failures = results
        .filter((r): r is { removed: null; error: string } => r.error !== null)
        .map((r) => ({ dir: r.error.split(': ')[0], error: r.error.split(': ').slice(1).join(': ') }));
      const removed = results.filter((r): r is { removed: string; error: null } => r.removed !== null).map((r) => r.removed);

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, removed, failures })}\n`);
        if (failures.length > 0) process.exitCode = 1;
        return;
      }

      if (failures.length > 0) {
        logError(`no se pudo eliminar: ${failures.map((f) => (f.dir ? `${f.dir}: ${f.error}` : f.error)).join('; ')}`, 'clean');
        process.exitCode = 1;
        return;
      }
      const relativeOut = relative(cwd, outputDir) || outputDir;
      logSuccess(`eliminado ${relativeOut}/ y .iteraciones/`, 'clean');
    },
    'Error desconocido al limpiar.',
  );
}

export async function runBuild(cwd: string, options: BuildOptions = {}): Promise<void> {
  let tracker: ProgressTracker | undefined;
  try {
    await assertProjectRoot(cwd);
    if (options.json && options.verbose) {
      throw new BuildError('--json y --verbose son mutuamente excluyentes: el JSON es la única salida de stdout');
    }
    let output = options.outputDir;
    if (output !== undefined) {
      const projectRoot = normalize(cwd);
      const resolved = isAbsolute(output) ? normalize(output) : join(projectRoot, output);
      if (resolved === projectRoot) {
        throw new BuildError(`--output "${output}" es la raíz del proyecto: la salida sobrescribiría los archivos fuente.`);
      }
      if (projectRoot.startsWith(`${resolved}/`)) {
        throw new BuildError(`--output "${output}" apunta a un directorio padre del proyecto, lo que podría sobrescribir los archivos fuente.`);
      }
      if (!resolved.startsWith(`${projectRoot}/`)) {
        throw new BuildError(`--output no puede apuntar fuera del proyecto (recibido: "${output}")`);
      }
      output = resolved;
    }

    const jsonStream = options.json ? ({ write: (): boolean => true, isTTY: false } as unknown as NodeJS.WriteStream) : undefined;
    tracker = new ProgressTracker({
      renderer: options.verbose ? 'verbose' : 'default',
      stream: jsonStream,
    });
    await build(cwd, { ...options, outputDir: output }, tracker);
  } catch (err) {
    reportBuildError(err, options.json, tracker?.getWarnings() ?? []);
    process.exitCode = 1;
  }
}

export function reportBuildError(err: unknown, json = false, warnings: string[] = []): void {
  if (json) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${JSON.stringify({ error: message, ...(warnings.length > 0 ? { warnings } : {}) })}\n`);
  }
  classifyAndReportError(err);
}

function classifyAndReportError(err: unknown): void {
  if (err instanceof ConversionError) {
    const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
    logError(`${err.message}${location}`);
    if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    if (err.code === PANDOC_ERROR_CODES.envMissing) {
      process.stderr.write("  ejecuta 'iteraciones doctor' para diagnosticar el entorno\n");
    }
  } else if (err instanceof ProcessSpawnError) {
    logError(err.message);
    process.stderr.write("  ejecuta 'iteraciones doctor' para diagnosticar el entorno\n");
  } else if (err instanceof ConfigError) {
    logError(err.message, 'config');
    process.stderr.write("  ejecuta 'iteraciones validate' para más detalle\n");
  } else if (err instanceof BuildError) {
    logError(err.message, 'build');
    if (err.code === BUILD_ERROR_CODES.frontmatterSyntax) {
      process.stderr.write("  ejecuta 'iteraciones validate' para más detalle\n");
    }
  } else if (err instanceof Error) {
    logError(err.message);
  } else {
    logError('Error desconocido al construir el proyecto.');
  }
}

async function buildProjectInfo(cwd: string): Promise<string[]> {
  const loaded = await loadSiteConfigIfPresent(cwd);
  if (!loaded) {
    return ["sin iteraciones.config.yaml — ejecuta 'iteraciones init' para crear la estructura del proyecto"];
  }
  const { config, presentKeys } = loaded;
  const pandocVersion = await getPandocVersion().catch(() => 'no disponible');
  const state = await loadStateFile(cwd);
  const distDir = state?.outputDir ?? join(cwd, DIST_FILES_DIR);
  const distExists = await stat(distDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  const activeFormats = computeActiveFormats(config.format);
  const disabledFilters = config.disabledFilters?.length ? config.disabledFilters.join(', ') : '(ninguno)';
  const preambleDisabled = presentKeys.has('format.pdf.disabledPreambleFilters') ? (config.format?.pdf?.disabledPreambleFilters ?? []) : [];
  const docCount = (await listMarkdownDocuments(cwd)).length;
  const html = config.format?.html;
  const theme = html?.site?.theme ?? '(por defecto)';
  const accent = html?.site?.color ?? '(por defecto)';

  const preambleConfigLabel = 'filters de preámbulo desactivados (config):';
  const preambleDefaultsLabel = 'filters de preámbulo desactivados (defaults del paquete):';
  const rows: [string, string][] = [
    ['language:', config.language],
    ['toc:', config.toc ? 'sí' : 'no'],
    ['documentos:', String(docCount)],
    ['salida:', `${distDir}${distExists ? ' (generado)' : ' (no generado)'}`],
    ['pandoc:', pandocVersion],
    ['formatos activos:', activeFormats.length > 0 ? activeFormats.join(', ') : '(ninguno)'],
    ['tema HTML:', theme],
    ['acento HTML:', accent],
    ['filters desactivados:', disabledFilters],
    [preambleConfigLabel, preambleDisabled.length > 0 ? preambleDisabled.join(', ') : '(ninguno)'],
    [preambleDefaultsLabel, DEFAULT_PDF_FORMAT.disabledPreambleFilters.join(', ')],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(labelWidth)} ${value}`);
}

export async function runInit(cwd: string): Promise<void> {
  await runCliCommand(cwd, 'init', () => initProject(cwd), 'Error desconocido al inicializar.', { createRoot: true });
}

export async function runValidate(cwd: string, options: { json?: boolean } = {}): Promise<void> {
  await runCliCommand(cwd, 'validate', () => validateProject(cwd, options), 'Error desconocido al validar.');
}

export async function runDoctor(cwd: string, options: { json?: boolean; info?: boolean } = {}): Promise<void> {
  await runCliCommand(
    cwd,
    'doctor',
    async () => {
      if (options.json) {
        const checks = await collectChecks(cwd);
        const ok = checks.filter((c) => !c.warn).every((c) => c.ok);
        const result: Record<string, unknown> = {
          ok,
          checks: checks.map((c: CheckResult) => ({ label: c.label, ok: c.ok, detail: c.detail ?? null, warn: c.warn ?? false })),
        };
        if (options.info) {
          result.config = await buildProjectInfo(cwd);
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (!ok) process.exitCode = 1;
        return;
      }
      if (options.info) {
        const lines = await buildProjectInfo(cwd);
        logInfo(`configuración del proyecto:\n${lines.join('\n')}`, 'doctor');
      }
      await doctorEnvironment(cwd);
    },
    'Error desconocido al ejecutar doctor.',
  );
}

export async function runNew(cwd: string, path: string, options: { title?: string } = {}): Promise<void> {
  try {
    await assertProjectRoot(cwd);
    const base = path.endsWith('.md') ? path : `${path}.md`;
    const normalizedPath = base.replace(/\s+/g, '-').replace(/-+/g, '-');

    if (isAbsolute(normalizedPath) || normalize(normalizedPath).startsWith('..')) {
      throw new Error(`la ruta debe ser relativa al directorio del proyecto (recibido: "${path}")`);
    }

    const fileName = basename(normalizedPath);
    if (!fileName || fileName === '.md' || fileName.startsWith('.')) {
      throw new Error(`la ruta debe incluir un nombre de archivo (recibido: "${path}"); por ejemplo "posts/mi-articulo.md"`);
    }

    const absPath = join(cwd, normalizedPath);
    await mkdir(dirname(absPath), { recursive: true });

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const title = options.title?.trim() || inferTitleFromPath(normalizedPath);
    const content = [
      '---',
      stringify({ title, date: today }, { defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE' }).trimEnd(),
      '---',
      '',
      'Escribe tu contenido aquí.',
      '',
      '<!-- Espacio vertical extra entre párrafos: una línea con solo :: -->',
      '',
      '::',
      '',
      '<!-- Epígrafe: fenced div con clase .dictum (opcional: autor con .author) -->',
      '',
      '::: {.dictum}',
      'La ciencia se compone de errores, que a su vez son los pasos hacia la verdad.',
      '::: ',
      '',
    ].join('\n');

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

export async function runFilters(cwd: string, options: RunFiltersOptions = {}): Promise<void> {
  await runCliCommand(cwd, 'filters', () => listFilters(cwd, options), 'Error desconocido al listar los filtros.');
}

function inferTitleFromPath(path: string): string {
  const base = basename(path, '.md').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Título del documento';
  return base
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
