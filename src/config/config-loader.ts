import { join } from 'node:path';
import { ConfigError } from '../errors.js';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_LATEX_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PAGINATION,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
  type EpubFormatConfig,
  type FormatConfig,
  type HtmlFormatConfig,
  KNOWN_ACCENT_COLORS,
  type LatexFormatConfig,
  type MarkdownFormatConfig,
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

  if (!(await file.exists()))
    return {
      ...DEFAULT_SITE_CONFIG,
      plugins: [...DEFAULT_SITE_CONFIG.plugins],
      disabledTranspilers: undefined,
    };

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

  if (!parsed || typeof parsed !== 'object')
    return {
      ...DEFAULT_SITE_CONFIG,
      plugins: [...DEFAULT_SITE_CONFIG.plugins],
      disabledTranspilers: undefined,
    };

  const root = parsed as Record<string, unknown>;
  const site = root.site && typeof root.site === 'object' ? (root.site as Record<string, unknown>) : {};

  const plugins = Array.isArray(root.plugins) ? root.plugins.filter((p): p is string => typeof p === 'string') : [...DEFAULT_SITE_CONFIG.plugins];
  const rawDisabled = root['disabled-transpilers'];
  const disabledTranspilers =
    Array.isArray(rawDisabled) && rawDisabled.length > 0 ? rawDisabled.filter((t): t is string => typeof t === 'string') : undefined;

  const title = typeof site.title === 'string' ? site.title : DEFAULT_SITE_CONFIG.title;
  const tagline = typeof site.tagline === 'string' ? site.tagline : DEFAULT_SITE_CONFIG.tagline;
  const lang = typeof site.lang === 'string' ? site.lang : DEFAULT_SITE_CONFIG.lang;
  const logo = typeof site.logo === 'string' ? site.logo : DEFAULT_SITE_CONFIG.logo;
  const baseUrl = typeof site['base-url'] === 'string' && site['base-url'].trim() ? site['base-url'].trim() : DEFAULT_SITE_CONFIG.baseUrl;

  const pagination = parsePaginationConfig(site.pagination);
  const format =
    typeof root.format === 'object' && root.format !== null
      ? parseFormatConfig(root.format as Record<string, unknown>)
      : {
          ...DEFAULT_SITE_CONFIG.format,
          html: { ...DEFAULT_HTML_FORMAT },
          pdf: { ...DEFAULT_PDF_FORMAT },
          epub: { ...DEFAULT_EPUB_FORMAT },
        };

  return {
    title,
    tagline,
    lang,
    logo,
    baseUrl,
    plugins,
    disabledTranspilers,
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
    markdown: parseMarkdownFormatConfig(raw.markdown),
    latex: parseLatexFormatConfig(raw.latex),
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
  const generate = typeof obj.generate === 'boolean' ? obj.generate : DEFAULT_HTML_FORMAT.generate;
  const rawThumbnails = obj.thumbnails;
  const thumbnails =
    rawThumbnails === 'responsive' ? 'responsive' : typeof rawThumbnails === 'boolean' ? rawThumbnails : DEFAULT_HTML_FORMAT.thumbnails;

  return { theme, accent, math, toc, tocDepth, hyphenation, generate, thumbnails };
}

const CUSTOM_PAGE_SIZE_RE = /^\d+(\.\d+)?(cm|mm|in|pt|truemm),\d+(\.\d+)?(cm|mm|in|pt|truemm)$/;

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

  // Solo pdflatex es soportado. Si se especifica otro valor, se usa el default.
  const engine = obj.engine === 'pdflatex' ? 'pdflatex' : DEFAULT_PDF_FORMAT.engine;

  const rawConcurrency = obj.concurrency;
  const concurrency =
    typeof rawConcurrency === 'number' && Number.isInteger(rawConcurrency) && rawConcurrency >= 1 ? rawConcurrency : DEFAULT_PDF_FORMAT.concurrency;
  if (rawConcurrency !== undefined && concurrency === DEFAULT_PDF_FORMAT.concurrency && rawConcurrency !== DEFAULT_PDF_FORMAT.concurrency) {
    process.stderr.write(
      `[iteraciones] format.pdf.concurrency: valor invalido "${String(rawConcurrency)}". Debe ser un entero >= 1. Usando ${DEFAULT_PDF_FORMAT.concurrency} por defecto.\n`,
    );
  }

  const hyphenation = typeof obj.hyphenation === 'boolean' ? obj.hyphenation : DEFAULT_PDF_FORMAT.hyphenation;
  const pdfx = typeof obj.pdfx === 'boolean' ? obj.pdfx : DEFAULT_PDF_FORMAT.pdfx;

  const toc = typeof obj.toc === 'boolean' ? obj.toc : DEFAULT_PDF_FORMAT.toc;
  const rawTocDepth = obj['toc-depth'];
  const tocDepth =
    typeof rawTocDepth === 'number' && Number.isInteger(rawTocDepth) && rawTocDepth >= 0 && rawTocDepth <= 5
      ? rawTocDepth
      : DEFAULT_PDF_FORMAT.tocDepth;

  const rawPageSize = obj['page-size'];
  let pageSize: string | undefined;
  if (typeof rawPageSize === 'string') {
    if (rawPageSize === 'custom') {
      pageSize = 'custom';
    } else if (CUSTOM_PAGE_SIZE_RE.test(rawPageSize)) {
      pageSize = rawPageSize; // dimension: "210mm,297mm"
    } else {
      // Cualquier nombre no vacio se trata como tamano estandar (a1, letter, b5, ...)
      pageSize = rawPageSize;
    }
  }
  if (typeof rawPageSize === 'string' && rawPageSize.trim() === '') {
    process.stderr.write(`[iteraciones] format.pdf.page-size: no puede estar vacio.\n`);
  }
  pageSize ??= DEFAULT_PDF_FORMAT.pageSize;

  const rawFontSize = obj['font-size'];
  const isFontSizeValid = typeof rawFontSize === 'string' && /^\d+pt$/.test(rawFontSize);
  const fontSize = isFontSizeValid ? rawFontSize : DEFAULT_PDF_FORMAT.fontSize;
  if (rawFontSize !== undefined && !isFontSizeValid) {
    process.stderr.write(`[iteraciones] format.pdf.font-size: debe ser un tamano LaTeX como "10pt", "11pt" o "12pt".\n`);
  }

  const fontFamily = typeof obj['font-family'] === 'string' && obj['font-family'].trim() ? obj['font-family'].trim() : DEFAULT_PDF_FORMAT.fontFamily;

  const rawGeometry = obj.geometry;
  let geometry: Record<string, string> | undefined;
  if (rawGeometry && typeof rawGeometry === 'object' && !Array.isArray(rawGeometry)) {
    const g = rawGeometry as Record<string, unknown>;
    const validKeys = ['paperwidth', 'paperheight', 'top', 'bottom', 'left', 'right', 'headheight', 'headsep', 'footskip'];
    const parsed: Record<string, string> = {};
    for (const key of validKeys) {
      const val = g[key];
      if (typeof val === 'string' && /^\d+(\.\d+)?(cm|mm|in|pt|truemm)$/.test(val)) {
        parsed[key] = val;
      }
    }
    if (Object.keys(parsed).length > 0) geometry = parsed;
  } else if (rawGeometry !== undefined) {
    process.stderr.write(
      `[iteraciones] format.pdf.geometry: debe ser un mapa con claves como top, bottom, left, right, headheight, headsep, footskip.\n`,
    );
  }
  geometry ??= DEFAULT_PDF_FORMAT.geometry;

  const rawLineSpacing = obj['line-spacing'];
  const lineSpacing = typeof rawLineSpacing === 'number' && rawLineSpacing > 0 ? rawLineSpacing : DEFAULT_PDF_FORMAT.lineSpacing;
  if (rawLineSpacing !== undefined && !(typeof rawLineSpacing === 'number' && rawLineSpacing > 0)) {
    process.stderr.write(`[iteraciones] format.pdf.line-spacing: debe ser un numero positivo.\n`);
  }

  const rawSecNumDepth = obj['sec-num-depth'];
  const secNumDepth =
    typeof rawSecNumDepth === 'number' && Number.isInteger(rawSecNumDepth) && rawSecNumDepth >= -2 && rawSecNumDepth <= 5
      ? rawSecNumDepth
      : DEFAULT_PDF_FORMAT.secNumDepth;

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

  const rawDocClass = obj.documentclass;
  const documentclass = rawDocClass === 'scrartcl' ? 'scrartcl' : rawDocClass === 'scrbook' ? 'scrbook' : undefined;
  if (rawDocClass !== undefined && rawDocClass !== 'scrartcl' && rawDocClass !== 'scrbook') {
    process.stderr.write(`[iteraciones] format.pdf.documentclass: valor desconocido "${String(rawDocClass)}". Valores validos: scrartcl, scrbook.\n`);
  }

  const sfdefaults = typeof obj.sfdefaults === 'boolean' ? obj.sfdefaults : undefined;

  const showDate = typeof obj['show-date'] === 'boolean' ? obj['show-date'] : DEFAULT_PDF_FORMAT.showDate;
  const respectHeaderPlain = typeof obj['respect-header-plain'] === 'boolean' ? obj['respect-header-plain'] : DEFAULT_PDF_FORMAT.respectHeaderPlain;
  const crop = typeof obj.crop === 'boolean' ? obj.crop : DEFAULT_PDF_FORMAT.crop;
  const esoPic = typeof obj['eso-pic'] === 'boolean' ? obj['eso-pic'] : DEFAULT_PDF_FORMAT.esoPic;

  return {
    engine,
    concurrency,
    hyphenation,
    pdfx,
    toc,
    tocDepth,
    secNumDepth,
    pageSize,
    fontSize,
    fontFamily,
    geometry,
    lineSpacing,
    pageNumber,
    sides,
    documentclass,
    sfdefaults,
    showDate,
    respectHeaderPlain,
    crop,
    esoPic,
    generate: typeof obj.generate === 'boolean' ? obj.generate : DEFAULT_PDF_FORMAT.generate,
    force: typeof obj.force === 'boolean' ? obj.force : DEFAULT_PDF_FORMAT.force,
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
  const rawEpubBib = obj.bibliography;
  const bibliography =
    typeof rawEpubBib === 'string' && rawEpubBib.trim() ? rawEpubBib.trim() : rawEpubBib === '' ? undefined : DEFAULT_EPUB_FORMAT.bibliography;
  const rawEpubCsl = obj.csl;
  const csl = typeof rawEpubCsl === 'string' && rawEpubCsl.trim() ? rawEpubCsl.trim() : rawEpubCsl === '' ? undefined : DEFAULT_EPUB_FORMAT.csl;

  return {
    toc,
    tocDepth,
    ...(bibliography !== undefined ? { bibliography } : {}),
    ...(csl !== undefined ? { csl } : {}),
    generate: typeof obj.generate === 'boolean' ? obj.generate : DEFAULT_EPUB_FORMAT.generate,
  };
}

function parseMarkdownFormatConfig(raw: unknown): MarkdownFormatConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MARKDOWN_FORMAT };
  const obj = raw as Record<string, unknown>;
  return {
    generate: typeof obj.generate === 'boolean' ? obj.generate : DEFAULT_MARKDOWN_FORMAT.generate,
  };
}

function parseLatexFormatConfig(raw: unknown): LatexFormatConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LATEX_FORMAT };
  const obj = raw as Record<string, unknown>;
  return {
    generate: typeof obj.generate === 'boolean' ? obj.generate : DEFAULT_LATEX_FORMAT.generate,
    force: typeof obj.force === 'boolean' ? obj.force : DEFAULT_LATEX_FORMAT.force,
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
