import { join } from 'node:path';
import { ConfigError } from '../errors.js';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_PAGINATION,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
  type EpubFormatConfig,
  type FormatConfig,
  type HtmlFormatConfig,
  KNOWN_ACCENT_COLORS,
  type PageNumberPlacement,
  type PaginationConfig,
  type PdfFormatConfig,
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

  const plugins = Array.isArray(root.plugins) ? root.plugins.filter((p): p is string => typeof p === 'string') : [...DEFAULT_SITE_CONFIG.plugins];

  const title = typeof site.title === 'string' ? site.title : DEFAULT_SITE_CONFIG.title;
  const tagline = typeof site.tagline === 'string' ? site.tagline : DEFAULT_SITE_CONFIG.tagline;
  const lang = typeof site.lang === 'string' ? site.lang : DEFAULT_SITE_CONFIG.lang;
  const logo = typeof site.logo === 'string' ? site.logo : DEFAULT_SITE_CONFIG.logo;
  const baseUrl = typeof site['base-url'] === 'string' && site['base-url'].trim() ? site['base-url'].trim() : DEFAULT_SITE_CONFIG.baseUrl;

  const pagination = parsePaginationConfig(site.pagination);
  const format =
    typeof root.format === 'object' && root.format !== null
      ? parseFormatConfig(root.format as Record<string, unknown>)
      : { ...DEFAULT_SITE_CONFIG.format, html: { ...DEFAULT_HTML_FORMAT }, pdf: { ...DEFAULT_PDF_FORMAT }, epub: { ...DEFAULT_EPUB_FORMAT } };

  return {
    title,
    tagline,
    lang,
    logo,
    baseUrl,
    plugins,
    pagination,
    format,
  };
}

// ── Parsers ──────────────────────────────────────────────────────────────

function parsePaginationConfig(raw: unknown): PaginationConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PAGINATION };
  const obj = raw as Record<string, unknown>;
  const rawLimit = obj.limit;
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_PAGINATION.limit;
  return { limit };
}

function parseFormatConfig(raw: Record<string, unknown>): FormatConfig {
  return {
    html: parseHtmlFormatConfig(raw.html) ?? { ...DEFAULT_HTML_FORMAT },
    pdf: parsePdfFormatConfig(raw.pdf),
    epub: parseEpubFormatConfig(raw.epub),
  };
}

function parseHtmlFormatConfig(raw: unknown): HtmlFormatConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const theme = typeof obj.theme === 'string' ? obj.theme : undefined;
  const accent = resolveAccent(obj.accent);
  const math = obj.math === 'katex' || obj.math === 'mathjax' ? obj.math : 'none';
  const toc = typeof obj.toc === 'boolean' ? obj.toc : DEFAULT_HTML_FORMAT.toc;
  const rawTocDepth = obj['toc-depth'];
  const tocDepth =
    typeof rawTocDepth === 'number' && Number.isInteger(rawTocDepth) && rawTocDepth >= 1 && rawTocDepth <= 6
      ? rawTocDepth
      : DEFAULT_HTML_FORMAT.tocDepth;
  const hyphenation = typeof obj.hyphenation === 'boolean' ? obj.hyphenation : DEFAULT_HTML_FORMAT.hyphenation;

  return { theme, accent, math, toc, tocDepth, hyphenation };
}

const CUSTOM_PAGE_SIZE_RE = /^\d+(\.\d+)?(cm|mm|in|pt),\d+(\.\d+)?(cm|mm|in|pt)$/;

const KNOWN_PAGE_SIZES = new Set<string>(['half-letter', 'letter', 'legal', 'executive', 'a3', 'a4', 'a5', 'b4', 'b5', 'tabloid', 'pocket']);

const KNOWN_PAGE_NUMBER_PLACEMENTS = new Set<string>([
  'footer-left',
  'footer-center',
  'footer-right',
  'header-left',
  'header-center',
  'header-right',
]);

const KNOWN_SIDES = new Set<string>(['oneside', 'twoside']);

function parsePdfFormatConfig(raw: unknown): PdfFormatConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PDF_FORMAT };
  const obj = raw as Record<string, unknown>;

  const engine = obj.engine === 'lualatex' ? 'lualatex' : DEFAULT_PDF_FORMAT.engine;

  const rawConcurrency = obj.concurrency;
  const concurrency =
    typeof rawConcurrency === 'number' && Number.isInteger(rawConcurrency) && rawConcurrency >= 1 ? rawConcurrency : DEFAULT_PDF_FORMAT.concurrency;
  if (rawConcurrency !== undefined && concurrency === DEFAULT_PDF_FORMAT.concurrency && rawConcurrency !== DEFAULT_PDF_FORMAT.concurrency) {
    process.stderr.write(
      `[iteraciones] format.pdf.concurrency: valor invalido "${String(rawConcurrency)}". Debe ser un entero >= 1. Usando ${DEFAULT_PDF_FORMAT.concurrency} por defecto.\n`,
    );
  }

  const hyphenation = typeof obj.hyphenation === 'boolean' ? obj.hyphenation : DEFAULT_PDF_FORMAT.hyphenation;
  const bibliography = typeof obj.bibliography === 'string' && obj.bibliography.trim() ? obj.bibliography.trim() : undefined;
  const csl = typeof obj.csl === 'string' && obj.csl.trim() ? obj.csl.trim() : undefined;

  const toc = typeof obj.toc === 'boolean' ? obj.toc : DEFAULT_PDF_FORMAT.toc;
  const rawTocDepth = obj['toc-depth'];
  const tocDepth =
    typeof rawTocDepth === 'number' && Number.isInteger(rawTocDepth) && rawTocDepth >= 0 && rawTocDepth <= 5
      ? rawTocDepth
      : DEFAULT_PDF_FORMAT.tocDepth;

  const rawPageSize = obj['page-size'];
  let pageSize: string | undefined;
  if (typeof rawPageSize === 'string') {
    if (KNOWN_PAGE_SIZES.has(rawPageSize) || CUSTOM_PAGE_SIZE_RE.test(rawPageSize)) {
      pageSize = rawPageSize;
    }
  }
  if (obj['page-size'] !== undefined && !pageSize) {
    process.stderr.write(
      `[iteraciones] format.pdf.page-size: valor desconocido "${String(obj['page-size'])}". Usa un nombre estandar (letter, a4, half-letter, etc.) o un tamano personalizado "ancho,alto" (ej: "15cm,23cm").\n`,
    );
  }
  pageSize ??= DEFAULT_PDF_FORMAT.pageSize;

  const rawFontSize = obj['font-size'];
  const isFontSizeValid = typeof rawFontSize === 'string' && /^\d+pt$/.test(rawFontSize);
  const fontSize = isFontSizeValid ? rawFontSize : DEFAULT_PDF_FORMAT.fontSize;
  if (rawFontSize !== undefined && !isFontSizeValid) {
    process.stderr.write(`[iteraciones] format.pdf.font-size: debe ser un tamano LaTeX como "10pt", "11pt" o "12pt".\n`);
  }

  const fontFamily = typeof obj['font-family'] === 'string' && obj['font-family'].trim() ? obj['font-family'].trim() : DEFAULT_PDF_FORMAT.fontFamily;

  const rawMargins = obj.margins;
  let margins: [string, string, string, string] | undefined;
  if (
    Array.isArray(rawMargins) &&
    rawMargins.length === 4 &&
    rawMargins.every((m) => typeof m === 'string' && /^\d+(\.\d+)?(cm|mm|in|pt)$/.test(m))
  ) {
    margins = rawMargins as [string, string, string, string];
  } else if (rawMargins !== undefined) {
    process.stderr.write(`[iteraciones] format.pdf.margins: debe ser un array de 4 strings con unidades (ej: ["2.5cm", "2.5cm", "3cm", "3cm"]).\n`);
  }
  margins ??= DEFAULT_PDF_FORMAT.margins;

  const rawLineSpacing = obj['line-spacing'];
  const lineSpacing = typeof rawLineSpacing === 'number' && rawLineSpacing > 0 ? rawLineSpacing : DEFAULT_PDF_FORMAT.lineSpacing;
  if (rawLineSpacing !== undefined && !(typeof rawLineSpacing === 'number' && rawLineSpacing > 0)) {
    process.stderr.write(`[iteraciones] format.pdf.line-spacing: debe ser un numero positivo.\n`);
  }

  const numbering = typeof obj.numbering === 'boolean' ? obj.numbering : DEFAULT_PDF_FORMAT.numbering;

  const rawPageNumber = obj['page-number'];
  const isPageNumberValid = typeof rawPageNumber === 'string' && KNOWN_PAGE_NUMBER_PLACEMENTS.has(rawPageNumber);
  const pageNumber = isPageNumberValid ? (rawPageNumber as PageNumberPlacement) : DEFAULT_PDF_FORMAT.pageNumber;
  if (rawPageNumber !== undefined && !isPageNumberValid) {
    process.stderr.write(
      `[iteraciones] format.pdf.page-number: valor desconocido "${String(rawPageNumber)}". Valores validos: footer-left, footer-center, footer-right, header-left, header-center, header-right.\n`,
    );
  }

  const rawSides = obj.sides;
  const isValidSides = typeof rawSides === 'string' && KNOWN_SIDES.has(rawSides);
  const sides = isValidSides ? (rawSides as Sides) : DEFAULT_PDF_FORMAT.sides;
  if (rawSides !== undefined && !isValidSides) {
    process.stderr.write(`[iteraciones] format.pdf.sides: valor desconocido "${String(rawSides)}". Valores validos: oneside, twoside.\n`);
  }

  return {
    engine,
    concurrency,
    hyphenation,
    toc,
    tocDepth,
    numbering,
    bibliography,
    csl,
    pageSize,
    fontSize,
    fontFamily,
    margins,
    lineSpacing,
    pageNumber,
    sides,
  };
}

function parseEpubFormatConfig(raw: unknown): EpubFormatConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EPUB_FORMAT };
  const obj = raw as Record<string, unknown>;

  const toc = typeof obj.toc === 'boolean' ? obj.toc : DEFAULT_EPUB_FORMAT.toc;
  const rawTocDepth = obj['toc-depth'];
  const tocDepth =
    typeof rawTocDepth === 'number' && Number.isInteger(rawTocDepth) && rawTocDepth >= 0 && rawTocDepth <= 5
      ? rawTocDepth
      : DEFAULT_EPUB_FORMAT.tocDepth;
  const bibliography = typeof obj.bibliography === 'string' && obj.bibliography.trim() ? obj.bibliography.trim() : undefined;
  const csl = typeof obj.csl === 'string' && obj.csl.trim() ? obj.csl.trim() : undefined;

  return {
    toc,
    tocDepth,
    ...(bibliography !== undefined ? { bibliography } : {}),
    ...(csl !== undefined ? { csl } : {}),
  };
}

function resolveAccent(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_HTML_FORMAT.accent!;
  if (!KNOWN_ACCENT_COLORS.has(value)) {
    process.stderr.write(`[iteraciones] color de acento desconocido: "${value}". Usando "${DEFAULT_HTML_FORMAT.accent}" por defecto.\n`);
    return DEFAULT_HTML_FORMAT.accent!;
  }
  return value;
}
