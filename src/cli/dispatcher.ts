import { exists, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { stringify } from 'yaml';
import { listMarkdownDocuments } from '../builder/gitignore.js';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { DIST_DIR, DIST_FILES_DIR } from '../builder/output-layout.js';
import { loadStateFile } from '../builder/state.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { computeActiveFormats, DEFAULT_PDF_FORMAT } from '../config/site-config.js';
import { BUILD_ERROR_CODES, BuildError, ConfigError, ConversionError, PANDOC_ERROR_CODES } from '../lib/errors.js';
import { logError, logInfo, logSuccess } from '../lib/logger.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { ProcessSpawnError } from '../lib/run.js';
import { doctorEnvironment } from './doctor.js';
import { listFilters, type RunFiltersOptions } from './filters.js';
import { initProject } from './init.js';
import { ProgressTracker } from './progress.js';
import { validateProject } from './validate.js';

/**
 * Verifica que el directorio raíz del proyecto exista y sea un directorio.
 * Todos los comandos la ejecutan al inicio: un --project-root inexistente
 * (o apuntando a un archivo) debe fallar con un mensaje accionable, no con
 * un ENOENT técnico del pipeline de descubrimiento.
 */
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

/**
 * Patrón de ejecución común de los comandos de la CLI: verifica la raíz del
 * proyecto, ejecuta la función y reporta cualquier error con logError fijando
 * process.exitCode = 1. `context` es el prefijo del logger y `unknownMessage`
 * el fallback cuando el error no es una instancia de Error (ningún throw del
 * código lanza otras cosas; la rama es defensiva). `runBuild` y `runNew`
 * conservan variantes propias: clasificación de errores y manejo de EEXIST.
 */
async function runCliCommand(
  cwd: string,
  context: string,
  fn: () => Promise<void>,
  unknownMessage: string,
  options: { createRoot?: boolean } = {},
): Promise<void> {
  try {
    if (options.createRoot) {
      // Primer contacto con la CLI (#2180): `init` crea la raíz si no existe
      // en lugar de fallar. El resto de comandos la exige (assertProjectRoot).
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

export async function runClean(cwd: string): Promise<void> {
  await runCliCommand(
    cwd,
    'clean',
    async () => {
      // La salida real es la del último build (state.json, #2183): con
      // `build --output out`, clean elimina `out/`, no un dist/ que no existe.
      // Sin estado (nunca hubo build): el default documentado (dist/).
      const state = await loadStateFile(cwd);
      const outputDir = state?.outputDir ?? join(cwd, DIST_DIR);
      // .iteraciones/ se elimina siempre: es la caché del propio CLI.
      // Solo se eliminan rutas declaradas por el estado o el default: nunca
      // rutas arbitrarias.
      const targets = [...new Set([outputDir, join(cwd, '.iteraciones')])];
      // Reportar por directorio qué no se pudo eliminar: un fallo de clean no debe
      // afirmar éxito (antes el catch traga cualquier error, EACCES incluido).
      const results = await Promise.all(
        targets.map(async (dir) => {
          try {
            await rm(dir, { recursive: true, force: true });
            return null;
          } catch (err) {
            return `${dir}: ${err instanceof Error ? err.message : String(err)}`;
          }
        }),
      );
      const failures = results.filter((r): r is string => r !== null);
      if (failures.length > 0) {
        logError(`no se pudo eliminar: ${failures.join('; ')}`, 'clean');
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
  try {
    await assertProjectRoot(cwd);
    // El JSON es la única salida de stdout: mezclarlo con el detalle humano
    // de --verbose rompería el contrato (docs/architecture.md).
    if (options.json && options.verbose) {
      throw new BuildError('--json y --verbose son mutuamente excluyentes: el JSON es la única salida de stdout');
    }
    // Validar y resolver --output: las rutas relativas se resuelven contra la
    // raíz del proyecto (--project-root), no contra el cwd del proceso.
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

    // El tracker (presentación) vive en la CLI y se inyecta en el build:
    // el builder no conoce la UI (inversión builder→cli, issue #2017).
    // Con --json el tracker escribe a un stream mudo: stdout queda reservado
    // para el objeto JSON final.
    const jsonStream = options.json ? ({ write: (): boolean => true, isTTY: false } as unknown as NodeJS.WriteStream) : undefined;
    const tracker = new ProgressTracker({
      renderer: options.verbose ? 'verbose' : 'default',
      stream: jsonStream,
    });
    await build(cwd, { ...options, outputDir: output }, tracker);
  } catch (err) {
    reportBuildError(err, options.json);
    process.exitCode = 1;
  }
}

/**
 * Reporta un error de build con el formato unificado y las sugerencias que
 * conectan con las herramientas de diagnóstico (#2082). Exportado para tests:
 * la clasificación usa códigos estructurales, nunca el texto del mensaje.
 */
export function reportBuildError(err: unknown, json = false): void {
  {
    // Con --json el fallo se reporta también como JSON válido en stdout: quien
    // consume el build programáticamente recibe siempre un objeto parseable
    // (el detalle humano sigue en stderr).
    if (json) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${JSON.stringify({ error: message })}\n`);
    }
    // Los errores de frontmatter/config del build se resuelven con validate:
    // la sugerencia conecta ambas herramientas (detalle completo por archivo).
    const suggestValidate = (): void => {
      process.stderr.write("  ejecuta 'iteraciones validate' para más detalle\n");
    };
    // Los errores de entorno (herramienta ausente en PATH) se diagnostican
    // con doctor: la sugerencia conecta build ↔ diagnóstico (#2082).
    const suggestDoctor = (): void => {
      process.stderr.write("  ejecuta 'iteraciones doctor' para diagnosticar el entorno\n");
    };
    if (err instanceof ConversionError) {
      const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
      logError(`${err.message}${location}`);
      if (err.stderr) process.stderr.write(`${err.stderr}\n`);
      if (err.code === PANDOC_ERROR_CODES.envMissing) suggestDoctor();
    } else if (err instanceof ProcessSpawnError) {
      logError(err.message);
      suggestDoctor();
    } else if (err instanceof ConfigError) {
      logError(err.message, 'config');
      suggestValidate();
    } else if (err instanceof BuildError) {
      logError(err.message, 'build');
      // La sugerencia de validate solo aplica a errores clasificados como
      // sintaxis YAML del frontmatter (código estructural, sin matchear el
      // texto del mensaje): los demás errores ya muestran su detalle completo.
      if (err.code === BUILD_ERROR_CODES.frontmatterSyntax) suggestValidate();
    } else if (err instanceof Error) {
      logError(err.message);
    } else {
      logError('Error desconocido al construir el proyecto.');
    }
  }
}

/** Información del proyecto para doctor --info (antes comando info). */
async function buildProjectInfo(cwd: string): Promise<string[]> {
  const loaded = await loadSiteConfigIfPresent(cwd);
  if (!loaded) {
    return ["sin iteraciones.config.yaml — ejecuta 'iteraciones init' para crear la estructura del proyecto"];
  }
  const { config, presentKeys } = loaded;
  const pandocVersion = await getPandocVersion().catch(() => 'no disponible');
  // El directorio de salida real es el del último build (state.json);
  // sin estado previo, el default.
  const state = await loadStateFile(cwd);
  const distDir = state?.outputDir ?? join(cwd, DIST_FILES_DIR);
  const distExists = await stat(distDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  const activeFormats = computeActiveFormats(config.format);
  const disabledFilters = config.disabledFilters?.length ? config.disabledFilters.join(', ') : '(ninguno)';
  // Distinguir lo que el usuario configuró de los defaults del paquete: el
  // conjunto de claves presentes en el YAML crudo (antes de que el schema
  // materialice los defaults) decide si la línea de config muestra la lista
  // materializada o (ninguno). Sin presencia, una clave escrita con valor
  // idéntico al default sería indistinguible de la ausente (workaround
  // anterior: sustraer DEFAULT_PDF_FORMAT.disabledPreambleFilters).
  const preambleDisabled = presentKeys.has('format.pdf.disabled-preamble-filters') ? (config.format?.pdf?.disabledPreambleFilters ?? []) : [];
  const docCount = (await listMarkdownDocuments(cwd)).length;
  const html = config.format?.html;
  const theme = html?.site?.theme ?? '(por defecto)';
  const accent = html?.site?.color ?? '(por defecto)';

  const preambleConfigLabel = 'filters de preámbulo desactivados (config):';
  const preambleDefaultsLabel = 'filters de preámbulo desactivados (defaults del paquete):';
  // Una sola cuadrícula para TODO el bloque (#2087): el ancho lo fija la
  // etiqueta más larga, no espacios manuales por fila.
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

export async function runValidate(cwd: string): Promise<void> {
  await runCliCommand(cwd, 'validate', () => validateProject(cwd), 'Error desconocido al validar.');
}

export async function runDoctor(cwd: string, options: { info?: boolean } = {}): Promise<void> {
  await runCliCommand(
    cwd,
    'doctor',
    async () => {
      // --info muestra la información del proyecto (antes comando info). Cada
      // línea lleva el prefijo y el glifo (formato unificado de la CLI).
      if (options.info) {
        const lines = await buildProjectInfo(cwd);
        for (const line of lines) {
          logInfo(line, 'doctor');
        }
      }
      await doctorEnvironment(cwd);
    },
    'Error desconocido al ejecutar doctor.',
  );
}

export async function runNew(cwd: string, path: string, options: { title?: string } = {}): Promise<void> {
  // Variante del patrón común (runCliCommand): el mensaje de error lleva el
  // path del usuario como prefijo y EEXIST no es un error, se informa y se
  // omite sin fijar exit code. El resto del patrón coincide con el helper.
  try {
    await assertProjectRoot(cwd);
    // Normalizar el nombre: espacios → guiones y separadores múltiples
    // colapsados ('mi articulo' → 'mi-articulo.md'). Coherente con
    // inferTitleFromPath, que convierte guiones en espacios para el título.
    const base = path.endsWith('.md') ? path : `${path}.md`;
    const normalizedPath = base.replace(/\s+/g, '-').replace(/-+/g, '-');

    if (isAbsolute(normalizedPath) || normalize(normalizedPath).startsWith('..')) {
      throw new Error(`la ruta debe ser relativa al directorio del proyecto (recibido: "${path}")`);
    }

    // El basename debe ser un nombre de archivo real: 'posts/' produce
    // 'posts/.md' y '.' produce '.md' (archivo oculto que el discovery nunca
    // procesa); un basename vacío u oculto crearía basura en el proyecto.
    const fileName = basename(normalizedPath);
    if (!fileName || fileName === '.md' || fileName.startsWith('.')) {
      throw new Error(`la ruta debe incluir un nombre de archivo (recibido: "${path}"); por ejemplo "posts/mi-articulo.md"`);
    }

    const absPath = join(cwd, normalizedPath);
    await mkdir(dirname(absPath), { recursive: true });

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // --title tiene prioridad; sin él se infiere del nombre del archivo.
    const title = options.title?.trim() || inferTitleFromPath(normalizedPath);
    // stringify escapa apóstrofos y comillas: el frontmatter generado siempre
    // es YAML válido (un title con comillas simples rompía el archivo).
    // El cuerpo incluye ejemplos del vocabulario semántico (:: y dictum) que
    // el usuario borra: la forma más barata de descubrir el lenguaje.
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

/**
 * Infiere un título legible desde la ruta del archivo: elimina la extensión
 * .md, reemplaza guiones y guiones bajos por espacios, y capitaliza la
 * primera letra de cada palabra. Ej: `posts/mi-articulo` → `Mi Articulo`.
 */
function inferTitleFromPath(path: string): string {
  const base = basename(path, '.md').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Título del documento';
  // Capitalizar la primera letra de cada palabra
  return base
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
