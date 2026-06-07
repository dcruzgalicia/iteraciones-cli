import { join } from 'node:path';
import { ConfigError } from '../errors.js';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_PAGINATION,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
  type EpubFormatConfig,
  type ExportConfig,
  type ExportHyphenationConfig,
  type FormatConfig,
  type FormatLayout,
  type HtmlConfig,
  type HtmlFormatConfig,
  KNOWN_ACCENT_COLORS,
  type LayoutConfig,
  type PageNumberPlacement,
  type PageSize,
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

  // Detectar schema nuevo: clave `format:` a nivel raiz
  const hasFormat = typeof root.format === 'object' && root.format !== null;

  if (hasFormat) {
    return buildConfigFromNewSchema(root);
  }

  // Schema viejo: advertir si se detectan claves antiguas que migraron a `format:`
  const site = root.site && typeof root.site === 'object' ? (root.site as Record<string, unknown>) : {};
  if (site.export !== undefined || site.html !== undefined || site['list-items'] !== undefined || site.math !== undefined) {
    process.stderr.write(
      '[iteraciones] El schema de configuracion en _iteraciones.yaml usa el formato antiguo.\n' +
        '  Las claves site.export, site.html, site.list-items y site.math seran eliminadas en una version futura.\n' +
        '  Migra al nuevo schema con la clave "format:" a nivel raiz. Consulta docs/configuration.md.\n',
    );
  }

  return buildConfigFromOldSchema(root);
}

// ── Schema nuevo ──────────────────────────────────────────────────────────

function buildConfigFromNewSchema(root: Record<string, unknown>): SiteConfig {
  const site = root.site && typeof root.site === 'object' ? (root.site as Record<string, unknown>) : {};
  const plugins = Array.isArray(root.plugins) ? root.plugins.filter((p): p is string => typeof p === 'string') : [...DEFAULT_SITE_CONFIG.plugins];

  const title = typeof site.title === 'string' ? site.title : DEFAULT_SITE_CONFIG.title;
  const tagline = typeof site.tagline === 'string' ? site.tagline : DEFAULT_SITE_CONFIG.tagline;
  const lang = typeof site.lang === 'string' ? site.lang : DEFAULT_SITE_CONFIG.lang;
  const logo = typeof site.logo === 'string' ? site.logo : DEFAULT_SITE_CONFIG.logo;
  const baseUrl = typeof site['base-url'] === 'string' && site['base-url'].trim() ? site['base-url'].trim() : DEFAULT_SITE_CONFIG.baseUrl;

  const pagination = parsePaginationConfig(site.pagination);
  const format = parseFormatConfig(root.format);

  // Poblar campos viejos para backward compat durante la migracion
  const listItemsLimit = pagination.limit;
  const htmlFmt = format?.html;
  const theme = htmlFmt?.theme;
  const accent = htmlFmt?.accent ?? DEFAULT_SITE_CONFIG.accent;
  const math = htmlFmt?.math;
  const html: HtmlConfig = {
    toc: htmlFmt?.toc ?? DEFAULT_SITE_CONFIG.html.toc,
    tocDepth: htmlFmt?.tocDepth ?? DEFAULT_SITE_CONFIG.html.tocDepth,
  };
  const exportCfg = buildExportConfigFromFormat(format);

  return {
    title,
    tagline,
    lang,
    logo,
    baseUrl,
    plugins,
    pagination,
    format,
    listItemsLimit,
    theme,
    accent,
    math,
    export: exportCfg,
    html,
  };
}

// ── Schema viejo ──────────────────────────────────────────────────────────

function buildConfigFromOldSchema(root: Record<string, unknown>): SiteConfig {
  const site = root.site && typeof root.site === 'object' ? (root.site as Record<string, unknown>) : {};
  const listItems = site['list-items'] && typeof site['list-items'] === 'object' ? (site['list-items'] as Record<string, unknown>) : {};

  const plugins = Array.isArray(root.plugins) ? root.plugins.filter((p): p is string => typeof p === 'string') : [...DEFAULT_SITE_CONFIG.plugins];

  const rawLimit = listItems.limit;
  const listItemsLimit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_SITE_CONFIG.listItemsLimit;

  const html = parseHtmlConfig(site.html);
  const exportCfg = parseExportConfig(site.export);
  const theme = resolveTheme(site.theme);
  const accent = resolveAccent(site.accent);
  const math = resolveMath(site.math);

  // Derivar campos nuevos desde los viejos
  const pagination: PaginationConfig = { limit: listItemsLimit };
  const format = buildFormatConfigFromLegacy(exportCfg, html, theme, accent, math);

  return {
    title: typeof site.title === 'string' ? site.title : DEFAULT_SITE_CONFIG.title,
    tagline: typeof site.tagline === 'string' ? site.tagline : DEFAULT_SITE_CONFIG.tagline,
    lang: typeof site.lang === 'string' ? site.lang : DEFAULT_SITE_CONFIG.lang,
    logo: typeof site.logo === 'string' ? site.logo : DEFAULT_SITE_CONFIG.logo,
    baseUrl: typeof site['base-url'] === 'string' && site['base-url'].trim() ? site['base-url'].trim() : DEFAULT_SITE_CONFIG.baseUrl,
    plugins,
    pagination,
    format,
    listItemsLimit,
    theme,
    accent,
    math,
    export: exportCfg,
    html,
  };
}

// ── Nuevos parsers ───────────────────────────────────────────────────────

function parsePaginationConfig(raw: unknown): PaginationConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PAGINATION };
  const obj = raw as Record<string, unknown>;
  const rawLimit = obj.limit;
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_PAGINATION.limit;
  return { limit };
}

function parseFormatConfig(raw: unknown): FormatConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const html = parseHtmlFormatConfig(obj.html);
  const pdf = parsePdfFormatConfig(obj.pdf);
  const epub = parseEpubFormatConfig(obj.epub);

  if (!html && !pdf && !epub) return undefined;

  return {
    ...(html ? { html } : {}),
    ...(pdf ? { pdf } : {}),
    ...(epub ? { epub } : {}),
  };
}

function parseHtmlFormatConfig(raw: unknown): HtmlFormatConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const theme = typeof obj.theme === 'string' ? obj.theme : undefined;
  const accent = resolveAccent(obj.accent);
  const math = obj.math === 'katex' || obj.math === 'mathjax' ? obj.math : undefined;
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

function parsePdfFormatConfig(raw: unknown): PdfFormatConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
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

  const toc = typeof obj.toc === 'boolean' ? obj.toc : undefined;
  const rawTocDepth = obj['toc-depth'];
  const tocDepth = typeof rawTocDepth === 'number' && Number.isInteger(rawTocDepth) && rawTocDepth >= 0 && rawTocDepth <= 5 ? rawTocDepth : undefined;

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

  const rawFontSize = obj['font-size'];
  const fontSize = typeof rawFontSize === 'string' && /^\d+pt$/.test(rawFontSize) ? rawFontSize : undefined;
  if (rawFontSize !== undefined && !fontSize) {
    process.stderr.write(`[iteraciones] format.pdf.font-size: debe ser un tamano LaTeX como "10pt", "11pt" o "12pt".\n`);
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
    process.stderr.write(`[iteraciones] format.pdf.margins: debe ser un array de 4 strings con unidades (ej: ["2.5cm", "2.5cm", "3cm", "3cm"]).\n`);
  }

  const rawLineSpacing = obj['line-spacing'];
  const lineSpacing = typeof rawLineSpacing === 'number' && rawLineSpacing > 0 ? rawLineSpacing : undefined;
  if (rawLineSpacing !== undefined && !lineSpacing) {
    process.stderr.write(`[iteraciones] format.pdf.line-spacing: debe ser un numero positivo.\n`);
  }

  const numbering = typeof obj.numbering === 'boolean' ? obj.numbering : undefined;

  const rawPageNumber = obj['page-number'];
  const pageNumber =
    typeof rawPageNumber === 'string' && KNOWN_PAGE_NUMBER_PLACEMENTS.has(rawPageNumber) ? (rawPageNumber as PageNumberPlacement) : undefined;
  if (rawPageNumber !== undefined && !pageNumber) {
    process.stderr.write(
      `[iteraciones] format.pdf.page-number: valor desconocido "${String(rawPageNumber)}". Valores validos: footer-left, footer-center, footer-right, header-left, header-center, header-right.\n`,
    );
  }

  const rawSides = obj.sides;
  const sides = typeof rawSides === 'string' && KNOWN_SIDES.has(rawSides) ? (rawSides as Sides) : undefined;
  if (rawSides !== undefined && !sides) {
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

function parseEpubFormatConfig(raw: unknown): EpubFormatConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const toc = typeof obj.toc === 'boolean' ? obj.toc : undefined;
  const rawTocDepth = obj['toc-depth'];
  const tocDepth = typeof rawTocDepth === 'number' && Number.isInteger(rawTocDepth) && rawTocDepth >= 0 && rawTocDepth <= 5 ? rawTocDepth : undefined;
  const bibliography = typeof obj.bibliography === 'string' && obj.bibliography.trim() ? obj.bibliography.trim() : undefined;
  const csl = typeof obj.csl === 'string' && obj.csl.trim() ? obj.csl.trim() : undefined;

  if (toc === undefined && tocDepth === undefined && !bibliography && !csl) return undefined;

  return {
    ...(toc !== undefined ? { toc } : {}),
    ...(tocDepth !== undefined ? { tocDepth } : {}),
    ...(bibliography !== undefined ? { bibliography } : {}),
    ...(csl !== undefined ? { csl } : {}),
  };
}

// ── Conversiones entre schemas ────────────────────────────────────────────

/** Deriva FormatConfig desde los campos del schema viejo (backward compat). */
function buildFormatConfigFromLegacy(
  exportCfg: ExportConfig | undefined,
  html: HtmlConfig,
  theme: string | undefined,
  accent: string,
  math: 'katex' | 'mathjax' | undefined,
): FormatConfig | undefined {
  const htmlFmt: HtmlFormatConfig = {
    theme,
    accent,
    math,
    toc: html.toc,
    tocDepth: html.tocDepth,
    hyphenation: exportCfg?.hyphenation?.html ?? false,
  };

  let pdf: PdfFormatConfig | undefined;
  const hasPdf = exportCfg?.formats.includes('pdf');
  if (hasPdf && exportCfg) {
    const layout = exportCfg.layout?.pdf;
    pdf = {
      engine: exportCfg.pdfEngine,
      concurrency: exportCfg.pdfConcurrency,
      hyphenation: exportCfg.hyphenation?.pdf ?? true,
      toc: layout?.toc,
      tocDepth: layout?.tocDepth,
      numbering: layout?.numbering,
      bibliography: exportCfg.bibliography,
      csl: exportCfg.csl,
      pageSize: layout?.pageSize,
      fontSize: layout?.fontSize,
      fontFamily: layout?.fontFamily,
      margins: layout?.margins,
      lineSpacing: layout?.lineSpacing,
      pageNumber: layout?.pageNumber,
      sides: layout?.sides,
    };
  }

  let epub: EpubFormatConfig | undefined;
  const hasEpub = exportCfg?.formats.includes('epub');
  if (hasEpub && exportCfg) {
    const epubDefaults = DEFAULT_EPUB_FORMAT;
    epub = {
      ...(epubDefaults.toc !== undefined ? { toc: epubDefaults.toc } : {}),
      ...(epubDefaults.tocDepth !== undefined ? { tocDepth: epubDefaults.tocDepth } : {}),
      ...(exportCfg.bibliography ? { bibliography: exportCfg.bibliography } : {}),
      ...(exportCfg.csl ? { csl: exportCfg.csl } : {}),
    };
  }

  if (!pdf && !epub) return undefined;

  return {
    html: htmlFmt,
    ...(pdf ? { pdf } : {}),
    ...(epub ? { epub } : {}),
  };
}

/** Deriva ExportConfig (viejo) desde FormatConfig para backward compat. */
function buildExportConfigFromFormat(format: FormatConfig | undefined): ExportConfig | undefined {
  if (!format) return undefined;

  const formats: Array<'pdf' | 'epub'> = [];
  if (format.pdf) formats.push('pdf');
  if (format.epub) formats.push('epub');
  if (formats.length === 0) return undefined;

  return {
    formats,
    pdfEngine: format.pdf?.engine ?? 'xelatex',
    pdfConcurrency: format.pdf?.concurrency ?? 2,
    ...(format.pdf?.bibliography ? { bibliography: format.pdf.bibliography } : {}),
    ...(format.pdf?.csl ? { csl: format.pdf.csl } : {}),
    hyphenation: {
      html: format.html?.hyphenation ?? false,
      pdf: format.pdf?.hyphenation ?? true,
    },
    ...(format.pdf
      ? {
          layout: {
            pdf: {
              ...(format.pdf.pageSize !== undefined ? { pageSize: format.pdf.pageSize } : {}),
              ...(format.pdf.fontSize !== undefined ? { fontSize: format.pdf.fontSize } : {}),
              ...(format.pdf.fontFamily !== undefined ? { fontFamily: format.pdf.fontFamily } : {}),
              ...(format.pdf.margins !== undefined ? { margins: format.pdf.margins } : {}),
              ...(format.pdf.lineSpacing !== undefined ? { lineSpacing: format.pdf.lineSpacing } : {}),
              ...(format.pdf.numbering !== undefined ? { numbering: format.pdf.numbering } : {}),
              ...(format.pdf.pageNumber !== undefined ? { pageNumber: format.pdf.pageNumber } : {}),
              ...(format.pdf.sides !== undefined ? { sides: format.pdf.sides } : {}),
              ...(format.pdf.toc !== undefined ? { toc: format.pdf.toc } : {}),
              ...(format.pdf.tocDepth !== undefined ? { tocDepth: format.pdf.tocDepth } : {}),
            },
          },
        }
      : {}),
  };
}

// ── Parsers viejos (sin cambios) ─────────────────────────────────────────

function parseExportConfig(raw: unknown): ExportConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const rawFormats = Array.isArray(obj.formats) ? obj.formats : [];

  const formats: Array<'pdf' | 'epub'> = [];
  const seen = new Set<string>();
  for (const f of rawFormats) {
    if (f !== 'pdf' && f !== 'epub') {
      process.stderr.write(`[iteraciones] export.formats: valor desconocido "${String(f)}". Los valores validos son "pdf" y "epub".\n`);
      continue;
    }
    if (seen.has(f)) {
      process.stderr.write(`[iteraciones] export.formats: "${f}" esta duplicado; se usara una sola vez.\n`);
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
      `[iteraciones] export.pdf-concurrency: valor invalido "${String(rawPdfConcurrency)}". Debe ser un entero >= 1. Usando 2 por defecto.\n`,
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
      `[iteraciones] export.layout.pdf.page-size: valor desconocido "${String(obj['page-size'])}". Usa un nombre estandar (letter, a4, half-letter, etc.) o un tamano personalizado "ancho,alto" (ej: "15cm,23cm").\n`,
    );
  }

  const fontSize = typeof obj['font-size'] === 'string' && /^\d+pt$/.test(obj['font-size']) ? obj['font-size'] : undefined;
  if (obj['font-size'] !== undefined && !fontSize) {
    process.stderr.write(`[iteraciones] export.layout.pdf.font-size: debe ser un tamano LaTeX como "10pt", "11pt" o "12pt".\n`);
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
    process.stderr.write(`[iteraciones] export.layout.pdf.line-spacing: debe ser un numero positivo.\n`);
  }

  const numbering = typeof obj.numbering === 'boolean' ? obj.numbering : undefined;

  const pageNumber =
    typeof obj['page-number'] === 'string' && KNOWN_PAGE_NUMBER_PLACEMENTS.has(obj['page-number'])
      ? (obj['page-number'] as PageNumberPlacement)
      : undefined;
  if (obj['page-number'] !== undefined && !pageNumber) {
    process.stderr.write(
      `[iteraciones] export.layout.pdf.page-number: valor desconocido "${String(obj['page-number'])}". Valores validos: footer-left, footer-center, footer-right, header-left, header-center, header-right.\n`,
    );
  }

  const sides = typeof obj.sides === 'string' && KNOWN_SIDES.has(obj.sides) ? (obj.sides as Sides) : undefined;
  if (obj.sides !== undefined && !sides) {
    process.stderr.write(`[iteraciones] export.layout.pdf.sides: valor desconocido "${String(obj.sides)}". Valores validos: oneside, twoside.\n`);
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

function parseHtmlConfig(raw: unknown): HtmlConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SITE_CONFIG.html };
  const obj = raw as Record<string, unknown>;
  const toc = typeof obj.toc === 'boolean' ? obj.toc : DEFAULT_SITE_CONFIG.html.toc;
  const rawDepth = obj['toc-depth'];
  const tocDepth =
    typeof rawDepth === 'number' && Number.isInteger(rawDepth) && rawDepth >= 1 && rawDepth <= 6 ? rawDepth : DEFAULT_SITE_CONFIG.html.tocDepth;
  return { toc, tocDepth };
}

function resolveTheme(siteValue: unknown): string | undefined {
  return typeof siteValue === 'string' ? siteValue : DEFAULT_SITE_CONFIG.theme;
}

function resolveMath(siteValue: unknown): 'katex' | 'mathjax' | undefined {
  return siteValue === 'katex' || siteValue === 'mathjax' ? siteValue : DEFAULT_SITE_CONFIG.math;
}
