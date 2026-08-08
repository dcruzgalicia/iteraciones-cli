import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_BLOCKS,
  DEFAULT_HTML_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
} from '../config/site-config.js';
import { logInfo, logSuccess } from '../lib/logger.js';

const DEFAULT_README = [
  '---',
  'title: "T\u00edtulo del documento"',
  'subtitle: "Subt\u00edtulo del documento"',
  'date: "2026-01-01"',
  'author:',
  '  - "Nombre del autor"',
  '  - "Segundo autor"',
  '---',
  '',
  '# T\u00edtulo del documento',
  '',
  'Este es un p\u00e1rrafo de ejemplo. Sustit\u00fayelo por tu propio texto.',
  '',
  '## Ep\u00edgrafe (dictum)',
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
  '## Cita bibliogr\u00e1fica',
  '',
  'Seg\u00fan @ejemplo2024, el uso de citekeys facilita la gesti\u00f3n de referencias.',
  '',
  '> Consulta docs/ejemplos.md para ver todos los elementos (verse, ::, listas, c\u00f3digo).',
].join('\n');

/**
 * Genera un iteraciones.config.yaml completo con todas las opciones posibles
 * y sus valores por defecto. Útil como referencia para nuevos usuarios.
 *
 * Se construye como objeto y se serializa con la libreria yaml (block style
 * legible); Bun.YAML.stringify no sirve aqui porque solo emite flow style.
 */
function buildDefaultConfig(): string {
  const format: Record<string, unknown> = {
    latex: false,
    html: {
      title: DEFAULT_HTML_FORMAT.title,
      tagline: DEFAULT_HTML_FORMAT.tagline,
      logo: DEFAULT_HTML_FORMAT.logo,
      theme: 'dark',
      accent: DEFAULT_HTML_FORMAT.accent,
      generate: DEFAULT_HTML_FORMAT.generate ?? true,
      blocks: { ...DEFAULT_HTML_BLOCKS },
    },
    pdf: {
      generate: DEFAULT_PDF_FORMAT.generate ?? false,
      'show-date': DEFAULT_PDF_FORMAT.showDate ?? false,
      'page-number': DEFAULT_PDF_FORMAT.pageNumber ?? 'header-right',
      'disabled-preamble-filters': DEFAULT_PDF_FORMAT.disabledPreambleFilters,
    },
    epub: { generate: DEFAULT_EPUB_FORMAT.generate ?? false },
    markdown: { generate: DEFAULT_MARKDOWN_FORMAT.generate ?? false },
  };

  let yaml = stringify({ lang: DEFAULT_SITE_CONFIG.lang, toc: DEFAULT_SITE_CONFIG.toc, format }, { indent: 2 }) + '\n';

  // Añadir comentarios explicativos sobre los defaults
  yaml = yaml.replace('    theme: dark', '    # Tema visual del HTML: "light" o "dark". Por defecto: dark.\n    theme: dark');
  yaml = yaml.replace(
    '    blocks:',
    '# Orden de los bloques del masonry: más alto = más tarde.\n' + '# El 1 queda libre (futura tarjeta volver-al-principio).\n' + '    blocks:',
  );
  yaml = yaml.replace(
    '    disabled-preamble-filters:',
    '# Los preamble filters 24, 25 y 26 añaden funcionalidades para impresión\n' +
      '# profesional (fondo de página, PDF/X-1a y marcas de corte). Vienen\n' +
      '# desactivados por defecto. Elimina nombres de esta lista para activarlos.\n' +
      '    disabled-preamble-filters:',
  );

  return yaml;
}

/**
 * Crea `iteraciones.config.yaml` y `README.md` en el directorio indicado.
 * Si alguno de los archivos ya existe, lo omite e informa al usuario.
 */
export async function runInit(cwd: string): Promise<void> {
  const DEFAULT_BIB = [
    '@book{ejemplo2024,',
    '  author    = {Autor, Nombre del},',
    '  title     = {T\u00edtulo del libro de ejemplo},',
    '  year      = {2024},',
    '  publisher = {Editorial de ejemplo},',
    '}',
    '',
  ].join('\n');

  const [configCreated, readmeCreated, bibCreated] = await Promise.all([
    createExclusive(join(cwd, 'iteraciones.config.yaml'), buildDefaultConfig()),
    createExclusive(join(cwd, 'README.md'), DEFAULT_README),
    createExclusive(join(cwd, 'bibliography.bib'), DEFAULT_BIB),
  ]);

  logInfo(configCreated ? 'creado iteraciones.config.yaml' : 'omitido iteraciones.config.yaml (ya existe)', 'init');
  logInfo(readmeCreated ? 'creado README.md' : 'omitido README.md (ya existe)', 'init');
  logInfo(bibCreated ? 'creado bibliography.bib' : 'omitido bibliography.bib (ya existe)', 'init');
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
