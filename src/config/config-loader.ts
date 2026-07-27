import { join } from 'node:path';
import { ZodError } from 'zod';
import { ConfigError } from '../lib/errors.js';
import { SiteConfigSchema } from './config-schema.js';
import { DEFAULT_PDF_FORMAT, type SiteConfig } from './site-config.js';

const CONFIG_FILE = '_iteraciones.yaml';

const ROOT_KNOWN_KEYS = new Set(['site', 'format', 'disabled-transpilers', 'disabled-preamble-transpilers']);
const SITE_KNOWN_KEYS = new Set(['title', 'tagline', 'lang', 'logo', 'base-url']);
const FORMAT_KNOWN_KEYS = new Set(['latex', 'pdf', 'html', 'epub', 'markdown']);
const HTML_KNOWN_KEYS = new Set(['theme', 'accent', 'generate']);
const EPUB_KNOWN_KEYS = new Set(['generate']);
const MD_KNOWN_KEYS = new Set(['generate']);

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
