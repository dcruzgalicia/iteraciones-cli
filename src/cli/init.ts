import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_LATEX_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
} from '../config/site-config.js';
import { logInfo, logSuccess } from '../lib/logger.js';

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
  'Este es el documento de inicio de tu proyecto: se convierte en `index.html`,',
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
  '> Consulta docs/ejemplos.md en el repositorio de iteraciones-cli',
  '> (https://github.com/dcruzgalicia/iteraciones-cli) para ver todos los elementos',
  '> (verse, ::, listas, código).',
].join('\n');

const quote = (value: string): string => JSON.stringify(value);

function buildDefaultConfig(): string {
  return [
    '# Configuración del proyecto. Consulta docs/configuration.md para ver todas las opciones.',
    `language: ${DEFAULT_SITE_CONFIG.language}`,
    `toc: ${DEFAULT_SITE_CONFIG.toc}`,
    'format:',
    '  latex:',
    `    generate: ${DEFAULT_LATEX_FORMAT.generate}`,
    '  html:',
    '    site:',
    `      title: ${quote(DEFAULT_HTML_FORMAT.site?.title ?? 'iteraciones')}`,
    `      description: ${quote(DEFAULT_HTML_FORMAT.site?.description ?? 'escribir, compartir, re-existir')}`,
    `      theme: ${DEFAULT_HTML_FORMAT.site?.theme ?? 'dark'}`,
    `      color: ${DEFAULT_HTML_FORMAT.site?.color ?? 'lime'}`,
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

const DEFAULT_GITIGNORE = ['# Generados por iteraciones (build y caché)', 'dist/', '.iteraciones/', '.DS_Store', ''].join('\n');

export async function initProject(cwd: string): Promise<void> {
  const DEFAULT_BIB = [
    '@book{ejemplo2024,',
    '  author    = {Autor, Nombre del},',
    '  title     = {Título del libro de ejemplo},',
    '  year      = {2024},',
    '  publisher = {Editorial de ejemplo},',
    '}',
    '',
  ].join('\n');

  const [configCreated, indexCreated, bibCreated, gitignoreCreated] = await Promise.all([
    createExclusive(join(cwd, 'iteraciones.config.yaml'), buildDefaultConfig()),
    createExclusive(join(cwd, 'index.md'), DEFAULT_INDEX),
    createExclusive(join(cwd, 'bibliography.bib'), DEFAULT_BIB),
    createExclusive(join(cwd, '.gitignore'), DEFAULT_GITIGNORE),
  ]);

  const report = (created: boolean, file: string): void => {
    if (created) logSuccess(`creado ${file}`, 'init');
    else logInfo(`omitido ${file} (ya existe)`, 'init');
  };
  report(configCreated, 'iteraciones.config.yaml');
  report(indexCreated, 'index.md');
  report(bibCreated, 'bibliography.bib');
  report(gitignoreCreated, '.gitignore');
  logSuccess("proyecto inicializado. Ejecuta 'iteraciones build' para generar los documentos.", 'init');
}

async function createExclusive(filePath: string, content: string): Promise<boolean> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}
