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

  const rawDisabledPreamble = root['disabled-preamble-transpilers'];
  const disabledPreambleTranspilers =
    Array.isArray(rawDisabledPreamble) && rawDisabledPreamble.length > 0
      ? rawDisabledPreamble.filter((t): t is string => typeof t === 'string')
      : undefined;

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
    disabledPreambleTranspilers,
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

const KNOWN_PAGE_NUMBER_PLACEMENTS = new Set<string>([
  'footer-left',
  'footer-center',
  'footer-right',
  'header-left',
  'header-center',
  'header-right',
]);

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

  const pdfx = typeof obj.pdfx === 'boolean' ? obj.pdfx : DEFAULT_PDF_FORMAT.pdfx;
  const toc = typeof obj.toc === 'boolean' ? obj.toc : DEFAULT_PDF_FORMAT.toc;
  const enumitem = typeof obj.enumitem === 'boolean' ? obj.enumitem : DEFAULT_PDF_FORMAT.enumitem;
  const crop = typeof obj.crop === 'boolean' ? obj.crop : DEFAULT_PDF_FORMAT.crop;

  // documentclass
  const rawDocClass = obj.documentclass;
  let documentclass: { class?: 'scrartcl' | 'scrbook'; options?: string[] } | undefined;
  if (rawDocClass && typeof rawDocClass === 'object' && !Array.isArray(rawDocClass)) {
    const dc = rawDocClass as Record<string, unknown>;
    const dcClass = typeof dc.class === 'string' && (dc.class === 'scrartcl' || dc.class === 'scrbook') ? dc.class : undefined;
    if (dc.class !== undefined && dcClass === undefined) {
      process.stderr.write(`[iteraciones] format.pdf.documentclass.class: valor desconocido "${String(dc.class)}". Valores validos: scrartcl, scrbook.\n`);
    }
    const dcOptions = Array.isArray(dc.options) && dc.options.every((v): v is string => typeof v === 'string') ? dc.options : undefined;
    if (dcClass || dcOptions) {
      documentclass = {};
      if (dcClass) documentclass.class = dcClass;
      if (dcOptions) documentclass.options = dcOptions;
    }
  }

  // geometry
  const rawGeometry = obj.geometry;
  let geometry: { options?: string[] } | undefined;
  if (rawGeometry && typeof rawGeometry === 'object' && !Array.isArray(rawGeometry)) {
    const g = rawGeometry as Record<string, unknown>;
    if (Array.isArray(g.options) && g.options.every((v): v is string => typeof v === 'string')) {
      geometry = { options: g.options };
    }
  }

  // babel
  const rawBabel = obj.babel;
  let babel: { options?: string[] } | undefined;
  if (rawBabel && typeof rawBabel === 'object' && !Array.isArray(rawBabel)) {
    const b = rawBabel as Record<string, unknown>;
    if (Array.isArray(b.options) && b.options.every((v): v is string => typeof v === 'string')) {
      babel = { options: b.options };
    }
  }

  // hyperref
  const rawHyperref = obj.hyperref;
  let hyperref: { options?: string[] } | undefined;
  if (rawHyperref && typeof rawHyperref === 'object' && !Array.isArray(rawHyperref)) {
    const h = rawHyperref as Record<string, unknown>;
    if (Array.isArray(h.options) && h.options.every((v): v is string => typeof v === 'string')) {
      hyperref = { options: h.options };
    }
  }

  // microtype
  const rawMicrotype = obj.microtype;
  let microtype: { options?: string[] } | undefined;
  if (rawMicrotype && typeof rawMicrotype === 'object' && !Array.isArray(rawMicrotype)) {
    const m = rawMicrotype as Record<string, unknown>;
    if (Array.isArray(m.options) && m.options.every((v): v is string => typeof v === 'string')) {
      microtype = { options: m.options };
    }
  }

  const mathptmx = typeof obj.mathptmx === 'boolean' ? obj.mathptmx : DEFAULT_PDF_FORMAT.mathptmx;
  const setspace = typeof obj.setspace === 'boolean' ? obj.setspace : DEFAULT_PDF_FORMAT.setspace;

  const showDate = typeof obj['show-date'] === 'boolean' ? obj['show-date'] : DEFAULT_PDF_FORMAT.showDate;

  const rawPageNumber = obj['page-number'];
  const isPageNumberValid = typeof rawPageNumber === 'string' && KNOWN_PAGE_NUMBER_PLACEMENTS.has(rawPageNumber);
  const pageNumber = isPageNumberValid ? (rawPageNumber as PageNumberPlacement) : DEFAULT_PDF_FORMAT.pageNumber;
  if (rawPageNumber !== undefined && !isPageNumberValid) {
    process.stderr.write(
      `[iteraciones] format.pdf.page-number: valor desconocido "${String(rawPageNumber)}". Valores validos: footer-left, footer-center, footer-right, header-left, header-center, header-right.\n`,
    );
  }

  const raggedbottom = typeof obj.raggedbottom === 'boolean' ? obj.raggedbottom : DEFAULT_PDF_FORMAT.raggedbottom;
  const pretolerance = typeof obj.pretolerance === 'number' ? obj.pretolerance : DEFAULT_PDF_FORMAT.pretolerance;
  const tolerance = typeof obj.tolerance === 'number' ? obj.tolerance : DEFAULT_PDF_FORMAT.tolerance;
  const brokenpenalty = typeof obj.brokenpenalty === 'number' ? obj.brokenpenalty : DEFAULT_PDF_FORMAT.brokenpenalty;
  const finalhyphendemerits = typeof obj['finalhyphendemerits'] === 'number' ? obj['finalhyphendemerits'] : DEFAULT_PDF_FORMAT.finalhyphendemerits;
  const doublehyphendemerits = typeof obj['doublehyphendemerits'] === 'number' ? obj['doublehyphendemerits'] : DEFAULT_PDF_FORMAT.doublehyphendemerits;
  const widowpenalty = typeof obj.widowpenalty === 'number' ? obj.widowpenalty : DEFAULT_PDF_FORMAT.widowpenalty;
  const clubpenalty = typeof obj.clubpenalty === 'number' ? obj.clubpenalty : DEFAULT_PDF_FORMAT.clubpenalty;

  // setstretch
  const rawSetstretch = obj.setstretch;
  const setstretch = typeof rawSetstretch === 'number' && rawSetstretch > 0 ? rawSetstretch : DEFAULT_PDF_FORMAT.setstretch;
  if (rawSetstretch !== undefined && !(typeof rawSetstretch === 'number' && rawSetstretch > 0)) {
    process.stderr.write(`[iteraciones] format.pdf.setstretch: debe ser un numero positivo.\n`);
  }

  // setlist
  const rawSetlist = obj.setlist;
  let setlist = DEFAULT_PDF_FORMAT.setlist;
  if (Array.isArray(rawSetlist)) {
    const parsed = rawSetlist
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        command: typeof s.command === 'string' ? s.command : DEFAULT_PDF_FORMAT.setlist![0]!.command,
        options: Array.isArray(s.options) && s.options.every((v: unknown): v is string => typeof v === 'string')
          ? s.options
          : DEFAULT_PDF_FORMAT.setlist![0]!.options,
      }));
    if (parsed.length > 0) setlist = parsed;
  }

  // setcounter
  const rawSetcounter = obj.setcounter;
  let setcounter: Record<string, number> | undefined;
  if (rawSetcounter && typeof rawSetcounter === 'object' && !Array.isArray(rawSetcounter)) {
    const parsed: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawSetcounter as Record<string, unknown>)) {
      if (typeof v === 'number') {
        parsed[k] = v;
      }
    }
    if (Object.keys(parsed).length > 0) setcounter = parsed;
  }

  // esoPic
  const rawEsoPic = obj['eso-pic'];
  let esoPic: { options?: string[] } | boolean | undefined;
  if (typeof rawEsoPic === 'boolean') {
    esoPic = rawEsoPic;
  } else if (rawEsoPic && typeof rawEsoPic === 'object' && !Array.isArray(rawEsoPic)) {
    const ep = rawEsoPic as Record<string, unknown>;
    if (Array.isArray(ep.options) && ep.options.every((v): v is string => typeof v === 'string')) {
      esoPic = { options: ep.options };
    } else if (Object.keys(ep).length > 0) {
      esoPic = { options: [] };
    }
  }

  return {
    engine,
    concurrency,
    documentclass,
    geometry,
    babel,
    hyperref,
    microtype,
    enumitem,
    setstretch,
    raggedbottom,
    pretolerance,
    tolerance,
    brokenpenalty,
    finalhyphendemerits,
    doublehyphendemerits,
    widowpenalty,
    clubpenalty,
    setlist,
    setcounter,
    esoPic,
    pdfx,
    crop,
    mathptmx,
    setspace,
    pageNumber,
    toc,
    showDate,
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
