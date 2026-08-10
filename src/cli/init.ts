import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_EPUB_FORMAT, DEFAULT_HTML_FORMAT, DEFAULT_MARKDOWN_FORMAT, DEFAULT_PDF_FORMAT, DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { logInfo, logSuccess } from '../lib/logger.js';

/** Fecha local actual en formato ISO (yyyy-mm-dd), como en `new`. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const DEFAULT_INDEX = [
  '---',
  'title: "Inicio"',
  `date: "${todayIso()}"`,
  '---',
  '',
  '# Inicio',
  '',
  'Este es el documento de inicio de tu sitio: se convierte en `index.html`,',
  'la página que enlazan las tarjetas de identidad del resto de documentos.',
  '',
  '## Epígrafe (dictum)',
  '',
  '::: {.dictum}',
  'La ciencia se compone de errores, que a su vez son los pasos',
  'hacia la verdad.',
  '',
  '::: {.author}',
  'Julio Verne',
  ':::',
  ':::',
  '',
  '## Cita bibliográfica',
  '',
  'Según @ejemplo2024, el uso de citekeys facilita la gestión de referencias.',
  '',
  '> Consulta docs/ejemplos.md para ver todos los elementos (verse, ::, listas, código).',
].join('\n');

const quote = (value: string): string => JSON.stringify(value);

/**
 * Genera un iteraciones.config.yaml mínimo con los campos esenciales y sus
 * valores por defecto (constantes DEFAULT_*). El resto de opciones (blocks,
 * show-date, page-number, disabled-preamble-filters, disabled-filters,
 * lua-filters, bibliography, csl) viven en docs/configuration.md.
 */
function buildDefaultConfig(): string {
  return [
    '# Configuración del sitio. Consulta docs/configuration.md para ver todas las opciones.',
    `lang: ${DEFAULT_SITE_CONFIG.lang}`,
    `toc: ${DEFAULT_SITE_CONFIG.toc}`,
    'format:',
    `  latex: ${DEFAULT_SITE_CONFIG.format.latex}`,
    '  html:',
    `    title: ${quote(DEFAULT_HTML_FORMAT.title)}`,
    `    tagline: ${quote(DEFAULT_HTML_FORMAT.tagline)}`,
    `    theme: ${DEFAULT_HTML_FORMAT.theme}`,
    `    accent: ${DEFAULT_HTML_FORMAT.accent}`,
    `    generate: ${DEFAULT_HTML_FORMAT.generate}`,
    '  pdf:',
    `    generate: ${DEFAULT_PDF_FORMAT.generate}`,
    '  epub:',
    `    generate: ${DEFAULT_EPUB_FORMAT.generate}`,
    '  markdown:',
    `    generate: ${DEFAULT_MARKDOWN_FORMAT.generate}`,
    '',
  ].join('\n');
}

/**
 * Crea `iteraciones.config.yaml`, `index.md` y `bibliography.bib` en el
 * directorio indicado. index.md es el documento de inicio: el primer build
 * produce un index.html real (el home que enlazan las tarjetas de identidad).
 * Si alguno de los archivos ya existe, lo omite e informa al usuario.
 */
export async function runInit(cwd: string): Promise<void> {
  const DEFAULT_BIB = [
    '@book{ejemplo2024,',
    '  author    = {Autor, Nombre del},',
    '  title     = {Título del libro de ejemplo},',
    '  year      = {2024},',
    '  publisher = {Editorial de ejemplo},',
    '}',
    '',
  ].join('\n');

  const [configCreated, indexCreated, bibCreated] = await Promise.all([
    createExclusive(join(cwd, 'iteraciones.config.yaml'), buildDefaultConfig()),
    createExclusive(join(cwd, 'index.md'), DEFAULT_INDEX),
    createExclusive(join(cwd, 'bibliography.bib'), DEFAULT_BIB),
  ]);

  // Patrón unificado: los comandos que mutan el proyecto (init, new, clean)
  // usan ✓ para lo creado/eliminado y sin glifo para lo omitido (no mutó).
  const report = (created: boolean, file: string): void => {
    if (created) logSuccess(`creado ${file}`, 'init');
    else logInfo(`omitido ${file} (ya existe)`, 'init');
  };
  report(configCreated, 'iteraciones.config.yaml');
  report(indexCreated, 'index.md');
  report(bibCreated, 'bibliography.bib');
  logSuccess("proyecto inicializado. Ejecuta 'iteraciones build' para generar el sitio.", 'init');
}

/**
 * Intenta crear el archivo con la bandera exclusiva `wx`.
 * Retorna true si se creó, false si ya existía (EEXIST).
 * Re-lanza cualquier otro error (EACCES, ENOTDIR, etc.).
 */
async function createExclusive(filePath: string, content: string): Promise<boolean> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}
