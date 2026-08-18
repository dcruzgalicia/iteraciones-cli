import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import { stringify } from 'yaml';
import { listMarkdownDocuments } from '../builder/gitignore.js';
import type { BuildOptions } from '../builder/orchestrator.js';
import { build } from '../builder/orchestrator.js';
import { loadStateFile } from '../builder/state.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { computeActiveFormats, DEFAULT_PDF_FORMAT } from '../config/site-config.js';
import { BuildError, ConfigError, PandocError } from '../lib/errors.js';
import { logError, logInfo, logSuccess } from '../lib/logger.js';
import { checkPandoc } from '../lib/pandoc-runner.js';
import { runDoctor as doctor } from './doctor.js';
import { runFilters as filters, type RunFiltersOptions } from './filters.js';
import { runInit as init } from './init.js';
import { runValidate as validate } from './validate.js';

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

export async function runClean(cwd: string): Promise<void> {
  try {
    await assertProjectRoot(cwd);
    const targets = [join(cwd, 'dist'), join(cwd, '.iteraciones')];
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
    logSuccess('eliminado dist/ y .iteraciones/', 'clean');
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, 'clean');
    } else {
      logError('Error desconocido al limpiar.', 'clean');
    }
    process.exitCode = 1;
  }
}

export async function runBuild(cwd: string, options: BuildOptions = {}): Promise<void> {
  try {
    await assertProjectRoot(cwd);
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

    await build(cwd, { ...options, outputDir: output });
  } catch (err) {
    // Los errores de frontmatter/config del build se resuelven con validate:
    // la sugerencia conecta ambas herramientas (detalle completo por archivo).
    const suggestValidate = (): void => {
      process.stderr.write("  ejecuta 'iteraciones validate' para más detalle\n");
    };
    if (err instanceof PandocError) {
      const location = err.sourcePath ? ` en "${err.sourcePath}"` : '';
      logError(`${err.message}${location}`);
      if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    } else if (err instanceof ConfigError) {
      logError(err.message, 'config');
      suggestValidate();
    } else if (err instanceof BuildError) {
      logError(err.message, 'build');
      // La sugerencia de validate solo aplica a errores de sintaxis YAML del
      // frontmatter (el bloque "frontmatter YAML inválido" va primero cuando
      // existe): los errores de validación de campos ya muestran su detalle
      // completo en el mensaje del build.
      if (err.message.startsWith('frontmatter YAML inválido')) suggestValidate();
    } else if (err instanceof Error) {
      logError(err.message);
    } else {
      logError('Error desconocido al construir el sitio.');
    }
    process.exitCode = 1;
  }
}

/** Información del proyecto para doctor --info (antes comando info). */
async function buildProjectInfo(cwd: string): Promise<string[]> {
  const config = await loadSiteConfig(cwd);
  const pandocVersion = await checkPandoc().catch(() => 'no disponible');
  // El directorio de salida real es el del último build (state.json);
  // sin estado previo, el default.
  const state = await loadStateFile(cwd);
  const distDir = state?.outputDir ?? join(cwd, 'dist', 'files');
  const distExists = await stat(distDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  const activeFormats = computeActiveFormats(config.format);
  const disabledFilters = config.disabledFilters?.length ? config.disabledFilters.join(', ') : '(ninguno)';
  // Distinguir lo que el usuario configuró de los defaults del paquete: el
  // schema materializa los defaults en format.pdf.disabledPreambleFilters, así
  // que la línea de config muestra solo los que NO son defaults del paquete
  // (el proyecto no "desactiva" 24-eso-pic/25-pdfx/26-crop — vienen
  // desactivados por defecto en DEFAULT_PDF_FORMAT).
  const defaultPreamble = DEFAULT_PDF_FORMAT.disabledPreambleFilters;
  const preambleDisabled = config.format?.pdf?.disabledPreambleFilters ?? [];
  const userPreamble = preambleDisabled.filter((name) => !defaultPreamble.includes(name));
  const docCount = (await listMarkdownDocuments(cwd)).length;
  const html = config.format?.html;
  const theme = html?.theme ?? '(por defecto)';
  const accent = html?.accent ?? '(por defecto)';

  const lines = [
    `  lang:                    ${config.lang}`,
    `  toc:                     ${config.toc ? 'sí' : 'no'}`,
    `  documentos:              ${docCount}`,
    `  salida:                  ${distDir}${distExists ? ' (generado)' : ' (no generado)'}`,
    `  pandoc:                  ${pandocVersion}`,
    `  formatos activos:        ${activeFormats.length > 0 ? activeFormats.join(', ') : '(ninguno)'}`,
    `  tema HTML:               ${theme}`,
    `  acento HTML:             ${accent}`,
    `  filters desactivados:    ${disabledFilters}`,
    `  preamble desactivados (config):          ${userPreamble.length > 0 ? userPreamble.join(', ') : '(ninguno)'}`,
    `  preamble desactivados (defaults del paquete): ${defaultPreamble.join(', ')}`,
  ];
  return lines;
}

export async function runInit(cwd: string): Promise<void> {
  try {
    await assertProjectRoot(cwd);
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
    await assertProjectRoot(cwd);
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

export async function runDoctor(cwd: string, options: { info?: boolean } = {}): Promise<void> {
  try {
    await assertProjectRoot(cwd);
    // --info muestra la información del proyecto (antes comando info). Cada
    // línea lleva el prefijo y el glifo (formato unificado de la CLI).
    if (options.info) {
      const lines = await buildProjectInfo(cwd);
      for (const line of lines) {
        logInfo(line, 'doctor');
      }
    }
    await doctor(cwd);
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message, 'doctor');
    } else {
      logError('Error desconocido al ejecutar doctor.');
    }
    process.exitCode = 1;
  }
}

export async function runNew(cwd: string, path: string, options: { title?: string } = {}): Promise<void> {
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
  try {
    await assertProjectRoot(cwd);
    await filters(cwd, options);
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
