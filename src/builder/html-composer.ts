import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';

// ---------------------------------------------------------------------------
// Template HTML efectivo: composición desde recursos por build.
// El orden de las tarjetas es format.html.blocks: la posición en la lista ES
// el orden (los bloques ausentes no se renderizan).
// ---------------------------------------------------------------------------

/** Recursos del template HTML del paquete. */
const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

/** Archivo de tarjeta por bloque (footer usa la variante sin comentario del header). */
const HTML_CARDS: Record<HtmlBlockKey, string> = {
  header: 'card-identity.html',
  contenido: 'card-contenido.html',
  formatos: 'card-formatos.html',
  indice: 'card-indice.html',
  referencias: 'card-referencias.html',
  footer: 'card-identity-footer.html',
};

/**
 * Resuelve el orden de los bloques del masonry. Una lista explícita en
 * `format.html.blocks` ES el orden (los bloques ausentes no se renderizan);
 * sin configurar, se usa DEFAULT_HTML_BLOCKS.
 */
export function resolveBlockOrder(overrides?: HtmlBlockKey[]): HtmlBlockKey[] {
  return overrides ?? [...DEFAULT_HTML_BLOCKS];
}

/**
 * Compone el template HTML efectivo del build: skeleton + tarjetas ordenadas
 * según format.html.blocks. Las tarjetas dinámicas (formatos) y el marcador
 * de referencias se resuelven por variables del template en cada documento;
 * el TOC lo genera pandoc con --toc en la posición de la tarjeta indice.
 */
export async function composeHtmlTemplate(siteConfig: SiteConfig): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const order = resolveBlockOrder(siteConfig.format?.html?.blocks);
  const blocks: string[] = [];
  for (const key of order) {
    const card = await Bun.file(join(HTML_RESOURCES_DIR, HTML_CARDS[key])).text();
    blocks.push(card);
  }
  return skeleton.replace('<!-- cards -->', blocks.join('\n'));
}

// ---------------------------------------------------------------------------
// Conversión markdown → formato (una invocación de pandoc por formato).
// ---------------------------------------------------------------------------

/**
 * Normaliza un valor string para `--metadata=clave:valor` de pandoc: los
 * saltos de línea se pliegan a espacios. Pandoc trata el resto de caracteres
 * (comillas, dos puntos, llaves) como literales dentro del valor y no pueden
 * inyectar claves ni romper el parseo (un solo elemento de argv); el plegado
 * explícito hace el comportamiento determinista.
 */
/** Variables de la plantilla HTML (template system de pandoc). */
export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  lang: string;
  theme?: string;
  accent?: string;
  css?: string;
  authorMeta?: string;
  logoInline?: string;
  /** Título del documento desde el frontmatter (undefined si es el default "Sin título"). */
  docTitle?: string;
  /** Subtítulo del documento desde el frontmatter. */
  subtitle?: string;
  /** Fecha del documento desde el frontmatter. */
  date?: string;
  /** Ruta relativa al home (./index.html, ../index.html, ../../index.html según la profundidad). */
  homeHref?: string;
  /** Enlaces a los formatos generados del documento (PDF/LaTeX/EPUB/Markdown). */
  formats?: FormatsLink[];
}

/** Clave canónica de un formato generado (los iconos se resuelven por ella). */
type ExportFormatKey = 'pdf' | 'epub' | 'latex' | 'markdown';

export interface FormatsLink {
  href: string;
  /** Clave canónica: resuelve el icono sin depender del nombre visible. */
  key: ExportFormatKey;
  /** Nombre visible (PDF, EPUB, LaTeX, Markdown). */
  name: string;
  description: string;
}

/** Iconos SVG de los formatos (trazo geométrico, mismo lenguaje del logo). */
const FORMAT_ICONS: Record<ExportFormatKey, string> = {
  pdf: '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h4M10 15h4"/></svg>',
  epub: '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z"/><path d="M12 6v14"/></svg>',
  latex:
    '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14"/><path d="M5 4l1.5 2M19 4l-1.5 2"/><path d="M12 4v16"/><path d="M8.5 20h7"/></svg>',
  markdown:
    '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14M5 10h10M5 14h14M5 18h8"/></svg>',
};

/**
 * Genera los elementos de la tarjeta Formatos (enlaces a los formatos
 * generados). El wrapper de la tarjeta vive en el recurso card-formatos.html
 * (diseño en recursos, sin clases en TS); aquí solo se sustituye la variable
 * `formats` del template. Sin formatos activos retorna undefined y el
 * $if(formats)$ del recurso omite el bloque.
 */
export function buildFormatsItems(formats: FormatsLink[]): string | undefined {
  if (formats.length === 0) return undefined;

  return formats
    .map(
      (f) =>
        `        <li>\n` +
        `          <a href="${f.href}" class="flex items-center gap-3 rounded-lg transition-colors duration-200 hover:bg-accent-500/10">\n` +
        `            <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-accent-500/30 bg-accent-500/10 text-accent-500">${FORMAT_ICONS[f.key]}</span>\n` +
        `            <div class="flex flex-col">\n` +
        `              <span class="text-lg font-semibold text-accent-950 dark:text-accent-50">${f.name}</span>\n` +
        `              <span class="text-sm italic text-accent-600 dark:text-accent-400">${f.description}</span>\n` +
        `            </div>\n` +
        `          </a>\n` +
        `        </li>`,
    )
    .join('\n');
}
