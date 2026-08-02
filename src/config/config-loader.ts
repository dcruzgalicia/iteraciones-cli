import { join } from 'node:path';
import { ZodError } from 'zod';
import { ConfigError } from '../lib/errors.js';
import { SiteConfigSchema } from './config-schema.js';
import { DEFAULT_PDF_FORMAT, type SiteConfig } from './site-config.js';

const CONFIG_FILE = '_iteraciones.yaml';

const ROOT_KNOWN_KEYS = new Set(['site', 'format', 'disabled-transpilers', 'disabled-preamble-transpilers', 'lua-filters']);
const SITE_KNOWN_KEYS = new Set(['title', 'tagline', 'lang', 'logo', 'base-url']);
const FORMAT_KNOWN_KEYS = new Set(['latex', 'pdf', 'html', 'epub', 'markdown']);
const HTML_KNOWN_KEYS = new Set(['theme', 'accent', 'generate']);
const EPUB_KNOWN_KEYS = new Set(['generate']);
const MD_KNOWN_KEYS = new Set(['generate']);

// Claves conocidas dentro de format.pdf
const PDF_KNOWN_KEYS = new Set([
  'generate',
  'documentclass',
  'geometry',
  'babel',
  'hyperref',
  'microtype',
  'enumitem',
  'font-family',
  'setspace',
  'setstretch',
  'raggedbottom',
  'pretolerance',
  'tolerance',
  'brokenpenalty',
  'hyphenpenalty',
  'finalhyphendemerits',
  'doublehyphendemerits',
  'widowpenalty',
  'clubpenalty',
  'setlist',
  'setcounter',
  'eso-pic',
  'pdfx',
  'crop',
  'page-number',
  'toc',
  'show-date',
  'sectioning',
  'setkomafont',
  'dictum',
]);
const PDF_DOCUMENTCLASS_KEYS = new Set(['class', 'options']);
const PDF_GEOMETRY_KEYS = new Set(['options']);
const PDF_BABEL_KEYS = new Set(['options']);
const PDF_HYPERREF_KEYS = new Set(['options']);
const PDF_MICROTYPE_KEYS = new Set(['options']);
const PDF_ESOPIC_KEYS = new Set(['options']);
const PDF_SETLIST_ITEM_KEYS = new Set(['command', 'options']);
const PDF_SECTIONING_LEVEL_KEYS = new Set(['style', 'beforeskip', 'afterskip', 'font', 'align', 'pagestyle']);
const SECTIONING_LEVEL_NAMES = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph']);

function warnUnknownKeys(obj: Record<string, unknown>, knownKeys: Set<string>, prefix: string): void {
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      process.stderr.write(`[iteraciones] _iteraciones.yaml: "${prefix}${key}" no es una clave válida. Revisa docs/configuration.md\n`);
    }
  }
}

export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
  const configPath = join(cwd, CONFIG_FILE);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return {
      title: 'iteraciones',
      tagline: 'escribir, compartir, re-existir',
      lang: 'es-MX',
      logo: '',
      baseUrl: undefined,
      format: {
        latex: true,
        html: { theme: undefined, accent: 'lime', generate: false },
        pdf: { ...DEFAULT_PDF_FORMAT },
        epub: { generate: false },
        markdown: { generate: false },
      },
      disabledTranspilers: undefined,
      disabledPreambleTranspilers: undefined,
      luaFilters: undefined,
    };
  }

  let raw: string;
  try {
    raw = await file.text();
  } catch (err) {
    throw new ConfigError(`No se pudo leer ${CONFIG_FILE}: ${String(err)}`, configPath);
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (err) {
    throw new ConfigError(`Error de sintaxis en ${CONFIG_FILE}: ${String(err)}`, configPath);
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      title: 'iteraciones',
      tagline: 'escribir, compartir, re-existir',
      lang: 'es-MX',
      logo: '',
      baseUrl: undefined,
      format: {
        latex: true,
        html: { theme: undefined, accent: 'lime', generate: false },
        pdf: { ...DEFAULT_PDF_FORMAT },
        epub: { generate: false },
        markdown: { generate: false },
      },
      disabledTranspilers: undefined,
      disabledPreambleTranspilers: undefined,
    };
  }

  const root = parsed as Record<string, unknown>;

  // Validar claves desconocidas
  warnUnknownKeys(root, ROOT_KNOWN_KEYS, '');
  if (root.site && typeof root.site === 'object' && !Array.isArray(root.site)) {
    warnUnknownKeys(root.site as Record<string, unknown>, SITE_KNOWN_KEYS, 'site.');
  }
  if (root.format && typeof root.format === 'object' && !Array.isArray(root.format)) {
    warnUnknownKeys(root.format as Record<string, unknown>, FORMAT_KNOWN_KEYS, 'format.');
  }
  const fmtRaw = root.format as Record<string, unknown> | undefined;
  if (fmtRaw?.html && typeof fmtRaw.html === 'object' && !Array.isArray(fmtRaw.html)) {
    warnUnknownKeys(fmtRaw.html as Record<string, unknown>, HTML_KNOWN_KEYS, 'format.html.');
  }
  if (fmtRaw?.epub && typeof fmtRaw.epub === 'object' && !Array.isArray(fmtRaw.epub)) {
    warnUnknownKeys(fmtRaw.epub as Record<string, unknown>, EPUB_KNOWN_KEYS, 'format.epub.');
  }
  if (fmtRaw?.markdown && typeof fmtRaw.markdown === 'object' && !Array.isArray(fmtRaw.markdown)) {
    warnUnknownKeys(fmtRaw.markdown as Record<string, unknown>, MD_KNOWN_KEYS, 'format.markdown.');
  }

  // ── Validar format.pdf ──
  const pdfRaw = fmtRaw?.pdf as Record<string, unknown> | undefined;
  if (pdfRaw && typeof pdfRaw === 'object' && !Array.isArray(pdfRaw)) {
    warnUnknownKeys(pdfRaw, PDF_KNOWN_KEYS, 'format.pdf.');

    // documentclass
    const dcRaw = pdfRaw.documentclass as Record<string, unknown> | undefined;
    if (dcRaw && typeof dcRaw === 'object' && !Array.isArray(dcRaw)) {
      warnUnknownKeys(dcRaw, PDF_DOCUMENTCLASS_KEYS, 'format.pdf.documentclass.');
    }

    // geometry, babel, hyperref, microtype
    for (const key of ['geometry', 'babel', 'hyperref', 'microtype'] as const) {
      const obj = pdfRaw[key] as Record<string, unknown> | undefined;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const keySet =
          key === 'geometry' ? PDF_GEOMETRY_KEYS : key === 'babel' ? PDF_BABEL_KEYS : key === 'hyperref' ? PDF_HYPERREF_KEYS : PDF_MICROTYPE_KEYS;
        warnUnknownKeys(obj, keySet, `format.pdf.${key}.`);
      }
    }

    // eso-pic (solo cuando es objeto)
    const esopicRaw = pdfRaw['eso-pic'] as Record<string, unknown> | undefined;
    if (esopicRaw && typeof esopicRaw === 'object' && !Array.isArray(esopicRaw)) {
      warnUnknownKeys(esopicRaw, PDF_ESOPIC_KEYS, 'format.pdf.eso-pic.');
    }

    // setlist (array de objetos)
    const setlistRaw = pdfRaw.setlist as unknown[] | undefined;
    if (Array.isArray(setlistRaw)) {
      for (let i = 0; i < setlistRaw.length; i++) {
        const item = setlistRaw[i] as Record<string, unknown> | undefined;
        if (item && typeof item === 'object') {
          warnUnknownKeys(item, PDF_SETLIST_ITEM_KEYS, `format.pdf.setlist[${i}].`);
        }
      }
    }

    // sectioning
    const secRaw = pdfRaw.sectioning as Record<string, unknown> | undefined;
    if (secRaw && typeof secRaw === 'object' && !Array.isArray(secRaw)) {
      for (const [levelName, levelData] of Object.entries(secRaw)) {
        if (!SECTIONING_LEVEL_NAMES.has(levelName)) {
          process.stderr.write(`[iteraciones] _iteraciones.yaml: "format.pdf.sectioning.${levelName}" no es un nivel de seccionamiento válido. Niveles válidos: ${[...SECTIONING_LEVEL_NAMES].join(', ')}
`);
        }
        if (levelData && typeof levelData === 'object' && !Array.isArray(levelData)) {
          warnUnknownKeys(levelData as Record<string, unknown>, PDF_SECTIONING_LEVEL_KEYS, `format.pdf.sectioning.${levelName}.`);
        }
      }
    }
  }

  try {
    return SiteConfigSchema.parse(root) as unknown as SiteConfig;
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const path = first?.path.join('.') ?? '';
      const message = first?.message ?? 'Error de validación';
      throw new ConfigError(`${path}: ${message}`, configPath);
    }
    throw err;
  }
}
