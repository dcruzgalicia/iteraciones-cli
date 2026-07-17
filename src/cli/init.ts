import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_LATEX_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PAGINATION,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
} from '../config/site-config.js';

const DEFAULT_README = [
  '---',
  'title: "T\u00edtulo del documento"',
  'date: "2026-01-01"',
  'author:',
  '  - "Nombre del autor"',
  'type: file',
  'keywords:',
  '  - "ejemplo"',
  '  - "documentaci\u00f3n"',
  'region: mx',
  'draft: false',
  'abstract: "Resumen o extracto breve del documento. Aparece en listados y previstas."',
  'tagline: "Subt\u00edtulo o descripci\u00f3n breve"',
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
  '> *Nota: Puedes explorar el código fuente de este README para',
  '> ver los ejemplos de ::, dictum y verse.*',
].join('\n');

/**
 * Genera un _iteraciones.yaml completo con todas las opciones posibles
 * y sus valores por defecto. Útil como referencia para nuevos usuarios.
 */
function buildDefaultConfig(): string {
  const pdfDefaults = DEFAULT_PDF_FORMAT;
  const lines: string[] = [];

  // ── site ──
  lines.push('site:');
  lines.push(`  title: ${yamlStr(DEFAULT_SITE_CONFIG.title)}`);
  lines.push(`  tagline: ${yamlStr(DEFAULT_SITE_CONFIG.tagline)}`);
  lines.push(`  lang: ${yamlStr(DEFAULT_SITE_CONFIG.lang)}`);
  lines.push(`  logo: ${yamlStr(DEFAULT_SITE_CONFIG.logo)}`);
  lines.push(`  base-url: ${yamlStr(DEFAULT_SITE_CONFIG.baseUrl ?? '')}`);
  lines.push('  pagination:');
  lines.push(`    limit: ${DEFAULT_PAGINATION.limit}`);
  lines.push('');

  // ── plugins ──
  lines.push('plugins: []');
  lines.push('');

  // ── format ──
  lines.push('format:');

  // html
  lines.push('  html:');
  lines.push(`    theme: dark`);
  lines.push(`    accent: ${DEFAULT_HTML_FORMAT.accent}`);
  lines.push(`    math: ${DEFAULT_HTML_FORMAT.math}`);
  lines.push(`    toc: ${yamlBool(DEFAULT_HTML_FORMAT.toc)}`);
  lines.push(`    toc-depth: ${DEFAULT_HTML_FORMAT.tocDepth}`);
  lines.push(`    hyphenation: ${yamlBool(DEFAULT_HTML_FORMAT.hyphenation)}`);
  lines.push(`    generate: ${yamlBool(DEFAULT_HTML_FORMAT.generate!)}`);
  lines.push(`    thumbnails: ${yamlValue(DEFAULT_HTML_FORMAT.thumbnails!)}`);

  // pdf — orden explícito de campos
  const pdfCfg = DEFAULT_PDF_FORMAT;
  lines.push('  pdf:');
  // 1. generate
  lines.push(`    generate: ${yamlBool(pdfCfg.generate!)}`);
  // 2. force
  lines.push(`    force: ${yamlBool(pdfCfg.force!)}`);
  // 3. engine
  lines.push(`    engine: ${yamlStr(pdfCfg.engine)}`);
  // 4. documentclass
  lines.push('    documentclass: scrbook');
  // 5. sfdefaults
  lines.push(`    sfdefaults: ${yamlBool(pdfCfg.sfdefaults!)}`);
  // 6. page-size (usar 'custom' para tamano personalizado en geometry)
  lines.push(`    page-size: ${yamlStr(pdfCfg.pageSize!)}`);
  // 7. page-number
  lines.push(`    page-number: ${yamlStr(pdfCfg.pageNumber!)}`);
  // 8. sides
  lines.push(`    sides: ${yamlStr(pdfCfg.sides!)}`);
  // 9. geometry (opciones para el paquete LaTeX geometry)
  lines.push('    geometry:');
  const geomOrder = ['paperwidth', 'paperheight', 'top', 'bottom', 'left', 'right', 'headheight', 'headsep', 'footskip'];
  for (const key of geomOrder) {
    const val = pdfCfg.geometry?.[key];
    if (val) lines.push(`      ${key}: ${yamlStr(val)}`);
  }
  // 10. line-spacing
  lines.push(`    line-spacing: ${yamlValue(pdfCfg.lineSpacing!)}`);
  // 11. font-family
  lines.push(`    font-family: ${yamlStr(pdfCfg.fontFamily!)}`);
  // 12. font-size
  lines.push(`    font-size: ${yamlStr(pdfCfg.fontSize!)}`);
  // 13. hyphenation
  lines.push(`    hyphenation: ${yamlBool(pdfCfg.hyphenation)}`);
  // 14. toc
  lines.push(`    toc: ${yamlBool(pdfCfg.toc!)}`);
  // 15. toc-depth
  lines.push(`    toc-depth: ${yamlValue(pdfCfg.tocDepth!)}`);
  // 16. sec-num-depth
  lines.push(`    sec-num-depth: ${yamlValue(pdfCfg.secNumDepth!)}`);
  // 17. bibliography
  lines.push(`    bibliography: ${yamlStr(pdfCfg.bibliography!)}`);
  // 18. csl
  lines.push(`    csl: ${yamlStr(pdfCfg.csl!)}`);
  // 19. respect-header-plain
  lines.push('    respect-header-plain: false');
  // 20. pdfx
  lines.push(`    pdfx: ${yamlBool(pdfCfg.pdfx)}`);
  // 21. crop
  lines.push(`    crop: ${yamlBool(pdfCfg.crop!)}`);
  // 22. eso-pic
  lines.push(`    eso-pic: ${yamlBool(pdfCfg.esoPic!)}`);

  // epub
  lines.push('  epub:');
  for (const [key, value] of Object.entries(DEFAULT_EPUB_FORMAT)) {
    const yamlKey = camelToKebab(key);
    if (value !== undefined) {
      lines.push(`    ${yamlKey}: ${yamlValue(value)}`);
    }
  }

  // markdown
  lines.push('  markdown:');
  for (const [key, value] of Object.entries(DEFAULT_MARKDOWN_FORMAT)) {
    const yamlKey = camelToKebab(key);
    lines.push(`    ${yamlKey}: ${yamlValue(value)}`);
  }

  // latex
  lines.push('  latex:');
  for (const [key, value] of Object.entries(DEFAULT_LATEX_FORMAT)) {
    const yamlKey = camelToKebab(key);
    lines.push(`    ${yamlKey}: ${yamlValue(value)}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Convierte camelCase a kebab-case para usar como keys YAML.
 */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Serializa un valor a YAML, manejando strings, booleanos y números.
 */
function yamlValue(value: unknown): string {
  if (typeof value === 'string') {
    return yamlStr(value);
  }
  if (typeof value === 'boolean') {
    return yamlBool(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value === undefined || value === null) {
    return '~';
  }
  return String(value);
}

/**
 * Serializa un string a YAML, añadiendo comillas cuando es necesario
 * para evitar ambigüedades (valores parecidos a booleanos, números, etc.).
 */
function yamlStr(s: string): string {
  // Si está vacío, siempre con comillas
  if (s === '') return '""';
  // Valores YAML ambiguos que necesitan comillas
  if (/^(true|false|yes|no|on|off|null|undefined|~)$/i.test(s)) return `"${s}"`;
  if (/^\d+(\.\d+)?$/.test(s)) return `"${s}"`;
  if (/^0x[0-9a-f]+$/i.test(s)) return `"${s}"`;
  if (/^['"!@#%&*[\]{}|>:`]/d.test(s) || /[\s,:]#/.test(s)) return `"${s}"`;
  // Contiene caracteres que requieren comillas dobles por escape
  if (/[\\"\n\t]/.test(s)) return JSON.stringify(s);
  return s;
}

/**
 * Serializa un booleano a YAML.
 */
function yamlBool(b: boolean): string {
  return b ? 'true' : 'false';
}

/**
 * Crea `_iteraciones.yaml` y `README.md` en el directorio indicado.
 * Si alguno de los archivos ya existe, lo omite e informa al usuario.
 */
export async function runInit(cwd: string): Promise<void> {
  const [configCreated, readmeCreated] = await Promise.all([
    createExclusive(join(cwd, '_iteraciones.yaml'), buildDefaultConfig()),
    createExclusive(join(cwd, 'README.md'), DEFAULT_README),
  ]);

  process.stdout.write(configCreated ? 'init: creado _iteraciones.yaml\n' : 'init: omitido _iteraciones.yaml (ya existe)\n');
  process.stdout.write(readmeCreated ? 'init: creado README.md\n' : 'init: omitido README.md (ya existe)\n');
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
