import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { DEFAULT_EPUB_FORMAT, DEFAULT_HTML_FORMAT, DEFAULT_MARKDOWN_FORMAT, DEFAULT_PDF_FORMAT, DEFAULT_SITE_CONFIG } from '../config/site-config.js';

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
  '# T\u00edtulo de nivel 1 (h1)',
  '',
  'Este es un p\u00e1rrafo de ejemplo. Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim',
  'veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  '',
  '## T\u00edtulo de nivel 2 (h2)',
  '',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat',
  'nulla pariatur. Excepteur sint occaecat cupidatat non proident.',
  '',
  '### T\u00edtulo de nivel 3 (h3)',
  '',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque',
  'laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis.',
  '',
  '#### T\u00edtulo de nivel 4 (h4)',
  '',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia',
  'consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.',
  '',
  '##### T\u00edtulo de nivel 5 (h5)',
  '',
  'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci',
  'velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam.',
  '',
  '###### T\u00edtulo de nivel 6 (h6)',
  '',
  'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit',
  'laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure',
  'reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur.',
  '',
  '## Listas',
  '',
  '- Elemento de lista no ordenada',
  '- Otro elemento',
  '- Un tercer elemento',
  '',
  '1. Elemento de lista ordenada',
  '2. Segundo elemento',
  '3. Tercer elemento',
  '',
  '## Citas',
  '',
  '> Esto es una cita en bloque. Puede contener m\u00faltiples p\u00e1rrafos.',
  '>',
  '> \u2014 Autor de la cita',
  '',
  '## C\u00f3digo',
  '',
  'Un fragmento de c\u00f3digo en l\u00ednea: `console.log("Hola mundo");`.',
  '',
  '```',
  '// Bloque de c\u00f3digo',
  'function saludar(nombre) {',
  '  return `Hola, ${nombre}!`;',
  '}',
  '```',
  '',
  '## \u00c9nfasis',
  '',
  '*Texto en cursiva* y **texto en negritas**.',
  '',
  'También se puede usar _cursiva_ y __negritas__ con guiones bajos.',
  '',
  '## Espacio vertical extra (::)',
  '',
  'Para forzar un espacio vertical extra entre párrafos, usa una línea',
  'que contenga únicamente dos puntos dobles: `::`:',
  '',
  '```',
  'Texto del primer párrafo.',
  '',
  '::',
  '',
  'Texto del segundo párrafo con espacio vertical extra.',
  '```',
  '',
  '## Epígrafe (dictum)',
  '',
  'Para incluir un epígrafe o cita destacada, usa un fenced div con',
  'la clase `.dictum`. Opcionalmente puedes añadir un autor con',
  'un fenced div anidado con clase `.author`.',
  '',
  '::: {.dictum}',
  'Dios hizo los números enteros, el resto es obra del hombre.',
  ':::',
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
  '## Poemas (verse)',
  '',
  'Para escribir poemas, usa un fenced div con la clase `.verse`.',
  '',
  '::: {.verse}',
  'Rosa de fuego,',
  'luminosa y efímera,',
  'florece en el aire.',
  ':::',
  '',
  '## Citas y referencias',
  '',
  'Puedes usar citas con pandoc citekeys. Por ejemplo:',
  '',
  'Según @ejemplo2024, el uso de citekeys facilita la gestión de referencias.',
  '',
  'También puedes usar citas entre corchetes: [@ejemplo2024, p. 42].',
  '',
  'Las referencias se generan automáticamente al final del documento.',
  '',
  '> *Nota: Puedes explorar el código fuente de este README para',
  '> ver los ejemplos de ::, dictum, verse y citas.*',
].join('\n');

/**
 * Genera un _iteraciones.yaml completo con todas las opciones posibles
 * y sus valores por defecto. Útil como referencia para nuevos usuarios.
 *
 * Se construye como objeto y se serializa con la libreria yaml (block style
 * legible); Bun.YAML.stringify no sirve aqui porque solo emite flow style.
 */
function buildDefaultConfig(): string {
  const pdf = DEFAULT_PDF_FORMAT;

  // ── site ──
  const site = {
    title: DEFAULT_SITE_CONFIG.title,
    tagline: DEFAULT_SITE_CONFIG.tagline,
    lang: DEFAULT_SITE_CONFIG.lang,
    logo: DEFAULT_SITE_CONFIG.logo,
    'base-url': DEFAULT_SITE_CONFIG.baseUrl ?? '',
  };

  // ── format.pdf (orden curado por secciones: CLASE → FUENTE → … → CONTADORES) ──
  const pdfConfig: Record<string, unknown> = {
    generate: pdf.generate ?? false,
    documentclass: pdf.documentclass,
    'font-family': [{ name: 'mathptmx' }],
    setspace: pdf.setspace ?? true,
  };
  if (pdf.setspace !== false) {
    pdfConfig.setstretch = pdf.setstretch ?? 1.5;
  }
  Object.assign(pdfConfig, {
    geometry: pdf.geometry,
    babel: pdf.babel,
    'page-number': pdf.pageNumber ?? 'header-right',
    microtype: pdf.microtype,
    raggedbottom: pdf.raggedbottom ?? true,
    pretolerance: pdf.pretolerance ?? 200,
    tolerance: pdf.tolerance ?? 400,
    brokenpenalty: pdf.brokenpenalty ?? 1_000_000,
    hyphenpenalty: pdf.hyphenpenalty ?? 100,
    finalhyphendemerits: pdf.finalhyphendemerits ?? 1_000_000,
    doublehyphendemerits: pdf.doublehyphendemerits ?? 1_000_000,
    widowpenalty: pdf.widowpenalty ?? 1_000_000,
    clubpenalty: pdf.clubpenalty ?? 1_000_000,
    hyperref: pdf.hyperref,
    enumitem: pdf.enumitem ?? true,
    setlist: pdf.setlist,
    'eso-pic': pdf.esoPic ?? false,
    pdfx: pdf.pdfx ?? false,
    crop: pdf.crop ?? false,
    setcounter: pdf.setcounter,
    sectioning: pdf.sectioning,
    setkomafont: pdf.setkomafont,
    dictum: pdf.dictum,
    toc: pdf.toc ?? false,
    'show-date': pdf.showDate ?? false,
  });

  // ── format ──
  const format: Record<string, unknown> = {
    latex: true,
    pdf: pdfConfig,
    html: {
      theme: 'dark',
      accent: DEFAULT_HTML_FORMAT.accent,
      generate: DEFAULT_HTML_FORMAT.generate ?? false,
    },
    epub: { generate: DEFAULT_EPUB_FORMAT.generate ?? false },
    markdown: { generate: DEFAULT_MARKDOWN_FORMAT.generate ?? false },
  };

  return stringify({ site, format }, { indent: 2 }) + '\n';
}

/**
 * Crea `_iteraciones.yaml` y `README.md` en el directorio indicado.
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
    createExclusive(join(cwd, '_iteraciones.yaml'), buildDefaultConfig()),
    createExclusive(join(cwd, 'README.md'), DEFAULT_README),
    createExclusive(join(cwd, 'bibliography.bib'), DEFAULT_BIB),
  ]);

  process.stdout.write(configCreated ? 'init: creado _iteraciones.yaml\n' : 'init: omitido _iteraciones.yaml (ya existe)\n');
  process.stdout.write(readmeCreated ? 'init: creado README.md\n' : 'init: omitido README.md (ya existe)\n');
  process.stdout.write(bibCreated ? 'init: creado bibliography.bib\n' : 'init: omitido bibliography.bib (ya existe)\n');
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
