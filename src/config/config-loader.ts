import { join } from 'node:path';
import { ConfigError } from '../errors.js';
import {
  DEFAULT_SITE_CONFIG,
  type ExportConfig,
  type ExportHyphenationConfig,
  type FormatLayout,
  KNOWN_ACCENT_COLORS,
  type LayoutConfig,
  type PageNumberPlacement,
  type PageSize,
  type Sides,
  type SiteConfig,
} from './site-config.js';

const CONFIG_FILE = '_iteraciones.yaml';

export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
  const configPath = join(cwd, CONFIG_FILE);
  const file = Bun.file(configPath);

  if (!(await file.exists())) return { ...DEFAULT_SITE_CONFIG, plugins: [...DEFAULT_SITE_CONFIG.plugins] };

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

  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SITE_CONFIG, plugins: [...DEFAULT_SITE_CONFIG.plugins] };

  const root = parsed as Record<string, unknown>;
  const site = root.site && typeof root.site === 'object' ? (root.site as Record<string, unknown>) : {};
  const listItems = site['list-items'] && typeof site['list-items'] === 'object' ? (site['list-items'] as Record<string, unknown>) : {};

  const plugins = Array.isArray(root.plugins) ? root.plugins.filter((p): p is string => typeof p === 'string') : [...DEFAULT_SITE_CONFIG.plugins];

  const rawLimit = listItems.limit;
  const listItemsLimit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_SITE_CONFIG.listItemsLimit;

  return {
    title: typeof site.title === 'string' ? site.title : DEFAULT_SITE_CONFIG.title,
    tagline: typeof site.tagline === 'string' ? site.tagline : DEFAULT_SITE_CONFIG.tagline,
    lang: typeof site.lang === 'string' ? site.lang : DEFAULT_SITE_CONFIG.lang,
    logo: typeof site.logo === 'string' ? site.logo : DEFAULT_SITE_CONFIG.logo,
    listItemsLimit,
    plugins,
    theme: resolveTheme(site.theme),
    accent: resolveAccent(site.accent),
    baseUrl: typeof site['base-url'] === 'string' && site['base-url'].trim() ? site['base-url'].trim() : DEFAULT_SITE_CONFIG.baseUrl,
    export: parseExportConfig(site.export),
    math: resolveMath(site.math),
  };
}

function parseExportConfig(raw: unknown): ExportConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const rawFormats = Array.isArray(obj.formats) ? obj.formats : [];

  // Validar cada formato individualmente y advertir sobre valores desconocidos.
  const formats: Array<'pdf' | 'epub'> = [];
  const seen = new Set<string>();
  for (const f of rawFormats) {
    if (f !== 'pdf' && f !== 'epub') {
      process.stderr.write(`[iteraciones] export.formats: valor desconocido "${String(f)}". Los valores válidos son "pdf" y "epub".\n`);
      continue;
    }
    if (seen.has(f)) {
      process.stderr.write(`[iteraciones] export.formats: "${f}" está duplicado; se usará una sola vez.\n`);
      continue;
    }
    seen.add(f);
    formats.push(f);
  }

  if (formats.length === 0) return undefined;
  const pdfEngine = obj['pdf-engine'] === 'lualatex' ? 'lualatex' : 'xelatex';
  const bibliography = typeof obj.bibliography === 'string' && obj.bibliography.trim() ? obj.bibliography.trim() : undefined;
  const csl = typeof obj.csl === 'string' && obj.csl.trim() ? obj.csl.trim() : undefined;
  const rawPdfConcurrency = obj['pdf-concurrency'];
  const pdfConcurrency =
    typeof rawPdfConcurrency === 'number' && Number.isInteger(rawPdfConcurrency) && rawPdfConcurrency >= 1 ? rawPdfConcurrency : 2;
  if (rawPdfConcurrency !== undefined && pdfConcurrency === 2 && rawPdfConcurrency !== 2) {
    process.stderr.write(
      `[iteraciones] export.pdf-concurrency: valor inválido "${String(rawPdfConcurrency)}". Debe ser un entero >= 1. Usando 2 por defecto.\n`,
    );
  }
  const hyphenation = parseHyphenationConfig(obj.hyphenation);
  const layout = parseLayoutConfig(obj.layout);
  return {
    formats,
    pdfEngine,
    pdfConcurrency,
    ...(bibliography !== undefined ? { bibliography } : {}),
    ...(csl !== undefined ? { csl } : {}),
    ...(hyphenation ? { hyphenation } : {}),
    ...(layout ? { layout } : {}),
  };
}

function parseHyphenationConfig(raw: unknown): ExportHyphenationConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const html = typeof obj.html === 'boolean' ? obj.html : false;
  const pdf = typeof obj.pdf === 'boolean' ? obj.pdf : true;
  if (html === false && pdf === true) return undefined;
  return { html, pdf };
}

const CUSTOM_PAGE_SIZE_RE = /^\d+(\.\d+)?(cm|mm|in|pt),\d+(\.\d+)?(cm|mm|in|pt)$/;

const KNOWN_PAGE_SIZES = new Set<string>(['half-letter', 'letter', 'legal', 'executive', 'a3', 'a4', 'a5', 'b4', 'b5', 'tabloid', 'pocket']);

function parseFormatLayout(raw: unknown): FormatLayout | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const rawPageSize = obj['page-size'];
  let pageSize: PageSize | undefined;
  if (typeof rawPageSize === 'string') {
    if (KNOWN_PAGE_SIZES.has(rawPageSize) || CUSTOM_PAGE_SIZE_RE.test(rawPageSize)) {
      pageSize = rawPageSize;
    }
  }
  if (obj['page-size'] !== undefined && !pageSize) {
    process.stderr.write(
      `[iteraciones] export.layout.pdf.page-size: valor desconocido "${String(obj['page-size'])}". Usa un nombre estándar (letter, a4, half-letter, etc.) o un tamaño personalizado "ancho,alto" (ej: "15cm,23cm").\n`,
    );
  }

  const fontSize = typeof obj['font-size'] === 'string' && /^\d+pt$/.test(obj['font-size']) ? obj['font-size'] : undefined;
  if (obj['font-size'] !== undefined && !fontSize) {
    process.stderr.write(`[iteraciones] export.layout.pdf.font-size: debe ser un tamaño LaTeX como "10pt", "11pt" o "12pt".\n`);
  }

  const fontFamily = typeof obj['font-family'] === 'string' && obj['font-family'].trim() ? obj['font-family'].trim() : undefined;

  const rawMargins = obj.margins;
  let margins: [string, string, string, string] | undefined;
  if (
    Array.isArray(rawMargins) &&
    rawMargins.length === 4 &&
    rawMargins.every((m) => typeof m === 'string' && /^\d+(\.\d+)?(cm|mm|in|pt)$/.test(m))
  ) {
    margins = rawMargins as [string, string, string, string];
  } else if (rawMargins !== undefined) {
    process.stderr.write(
      `[iteraciones] export.layout.pdf.margins: debe ser un array de 4 strings con unidades (ej: ["2.5cm", "2.5cm", "3cm", "3cm"]).\n`,
    );
  }

  const lineSpacing = typeof obj['line-spacing'] === 'number' && obj['line-spacing'] > 0 ? obj['line-spacing'] : undefined;
  if (obj['line-spacing'] !== undefined && !lineSpacing) {
    process.stderr.write(`[iteraciones] export.layout.pdf.line-spacing: debe ser un número positivo.\n`);
  }

  const numbering = typeof obj.numbering === 'boolean' ? obj.numbering : undefined;

  const KNOWN_PAGE_NUMBER_PLACEMENTS = new Set<string>([
    'footer-left',
    'footer-center',
    'footer-right',
    'header-left',
    'header-center',
    'header-right',
  ]);
  const pageNumber =
    typeof obj['page-number'] === 'string' && KNOWN_PAGE_NUMBER_PLACEMENTS.has(obj['page-number'])
      ? (obj['page-number'] as PageNumberPlacement)
      : undefined;
  if (obj['page-number'] !== undefined && !pageNumber) {
    process.stderr.write(
      `[iteraciones] export.layout.pdf.page-number: valor desconocido "${String(obj['page-number'])}". Valores válidos: footer-left, footer-center, footer-right, header-left, header-center, header-right.\n`,
    );
  }

  const KNOWN_SIDES = new Set<string>(['oneside', 'twoside']);
  const sides = typeof obj.sides === 'string' && KNOWN_SIDES.has(obj.sides) ? (obj.sides as Sides) : undefined;
  if (obj.sides !== undefined && !sides) {
    process.stderr.write(`[iteraciones] export.layout.pdf.sides: valor desconocido "${String(obj.sides)}". Valores válidos: oneside, twoside.\n`);
  }

  const toc = typeof obj.toc === 'boolean' ? obj.toc : undefined;

  const rawTocDepth = obj['toc-depth'];
  const tocDepth = typeof rawTocDepth === 'number' && Number.isInteger(rawTocDepth) && rawTocDepth >= 0 && rawTocDepth <= 5 ? rawTocDepth : undefined;

  if (
    !pageSize &&
    !fontSize &&
    !fontFamily &&
    !margins &&
    lineSpacing === undefined &&
    numbering === undefined &&
    !pageNumber &&
    !sides &&
    toc === undefined &&
    tocDepth === undefined
  )
    return undefined;

  return {
    pageSize,
    fontSize,
    fontFamily,
    margins,
    lineSpacing,
    numbering,
    pageNumber,
    sides,
    ...(toc !== undefined ? { toc } : {}),
    ...(tocDepth !== undefined ? { tocDepth } : {}),
  };
}

function parseLayoutConfig(raw: unknown): LayoutConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const pdf = parseFormatLayout(obj.pdf);
  return pdf ? { pdf } : undefined;
}

function resolveAccent(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SITE_CONFIG.accent;
  if (!KNOWN_ACCENT_COLORS.has(value)) {
    process.stderr.write(`[iteraciones] color de acento desconocido: "${value}". Usando "${DEFAULT_SITE_CONFIG.accent}" por defecto.\n`);
    return DEFAULT_SITE_CONFIG.accent;
  }
  return value;
}

function resolveTheme(siteValue: unknown): string | undefined {
  return typeof siteValue === 'string' ? siteValue : DEFAULT_SITE_CONFIG.theme;
}

function resolveMath(siteValue: unknown): 'katex' | 'mathjax' | undefined {
  return siteValue === 'katex' || siteValue === 'mathjax' ? siteValue : DEFAULT_SITE_CONFIG.math;
}
