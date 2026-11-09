import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { writeExclusive } from '../builder/pipeline-io.js';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_LATEX_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
} from '../config/site-config.js';
import { todayIso } from '../lib/date.js';
import { logInfo, logSuccess } from '../lib/logger.js';

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
].join('\n');

function buildDefaultConfig(): string {
  return stringify({
    language: DEFAULT_SITE_CONFIG.language,
    toc: DEFAULT_SITE_CONFIG.toc,
    format: {
      latex: { generate: DEFAULT_LATEX_FORMAT.generate },
      html: {
        site: {
          title: DEFAULT_HTML_FORMAT.site.title,
          description: DEFAULT_HTML_FORMAT.site.description,
          theme: DEFAULT_HTML_FORMAT.site.theme,
          color: DEFAULT_HTML_FORMAT.site.color,
        },
        generate: DEFAULT_HTML_FORMAT.generate,
      },
      pdf: { generate: DEFAULT_PDF_FORMAT.generate },
      epub: { generate: DEFAULT_EPUB_FORMAT.generate },
      markdown: { generate: DEFAULT_MARKDOWN_FORMAT.generate },
    },
  });
}

const DEFAULT_GITIGNORE = [
  '# Generados por iteraciones (build y caché)',
  'dist/',
  '.iteraciones/',
  'node_modules/',

  'build.sh',
  '.DS_Store',

  '# diffs de los snapshots: se regeneran con iteraciones snapshots check',
  'diff/',
  '',
].join('\n');

type GitignoreResult = 'creado' | 'actualizado' | 'sin-cambios';

async function ensureGitignore(cwd: string): Promise<GitignoreResult> {
  const ruta = join(cwd, '.gitignore');
  const existente = await Bun.file(ruta)
    .text()
    .catch(() => null);
  if (existente === null) {
    await writeFile(ruta, DEFAULT_GITIGNORE);
    return 'creado';
  }
  const lineas = existente.split(/\r?\n/).map((linea) => linea.trim());
  if (lineas.includes('node_modules/') || lineas.includes('node_modules')) return 'sin-cambios';
  const eol = existente.includes('\r\n') ? '\r\n' : '\n';
  const base = existente === '' || existente.endsWith('\n') ? existente : `${existente}${eol}`;
  await writeFile(ruta, `${base}node_modules/${eol}`);
  return 'actualizado';
}

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

  const [configCreated, indexCreated, bibCreated, gitignore] = await Promise.all([
    writeExclusive(join(cwd, 'iteraciones.config.yaml'), buildDefaultConfig()),
    writeExclusive(join(cwd, 'index.md'), DEFAULT_INDEX),
    writeExclusive(join(cwd, 'bibliography.bib'), DEFAULT_BIB),
    ensureGitignore(cwd),
  ]);

  const report = (created: boolean, file: string): void => {
    if (created) logSuccess(`creado ${file}`, 'init');
    else logInfo(`omitido ${file} (ya existe)`, 'init');
  };
  report(configCreated, 'iteraciones.config.yaml');
  report(indexCreated, 'index.md');
  report(bibCreated, 'bibliography.bib');
  if (gitignore === 'actualizado') logSuccess('actualizado .gitignore (node_modules/)', 'init');
  else report(gitignore === 'creado', '.gitignore');
  logSuccess("proyecto inicializado. Ejecuta 'iteraciones build' para generar los documentos.", 'init');
}
