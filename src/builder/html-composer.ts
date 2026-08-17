import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';

// ---------------------------------------------------------------------------
// Template HTML efectivo: composición desde recursos por build.
// El orden de las tarjetas se deriva de format.html.blocks: los bloques con
// número negativo van antes del body (trayectura), los positivos después;
// el orden dentro de cada grupo lo da el número (el body es el cero).
// ---------------------------------------------------------------------------

/** Recursos del template HTML del paquete. */
const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

/** Archivo de tarjeta por bloque (footer usa la variante sin comentario del header). */
const HTML_CARDS: Record<HtmlBlockKey, string> = {
  header: 'card-identity.html',
  trayectura: 'card-trayectura.html',
  formatos: 'card-formatos.html',
  indice: 'card-indice.html',
  referencias: 'card-referencias.html',
  footer: 'card-identity-footer.html',
};

/**
 * Resuelve el orden de los bloques del masonry: merge de los defaults con los
 * overrides individuales (`format.html.blocks`). Cada clave es opcional; sin
 * ella usa su default. Los empates de número se desempatan por el orden
 * canónico de claves (header → trayectura → formatos → indice → referencias →
 * footer), de modo que el resultado es determinista.
 */
export function resolveBlockOrder(overrides?: Partial<Record<HtmlBlockKey, number>>): HtmlBlockKey[] {
  const canonical = Object.keys(DEFAULT_HTML_BLOCKS) as HtmlBlockKey[];
  const order: Record<HtmlBlockKey, number> = { ...DEFAULT_HTML_BLOCKS, ...overrides };
  return [...canonical].sort((a, b) => order[a] - order[b] || canonical.indexOf(a) - canonical.indexOf(b));
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
 * Reader de markdown con auto-identifiers activos (headings con `id` para el
 * TOC) y la extensión `mark` (`==texto==` → resaltado → \hl{} en LaTeX y
 * <mark> en HTML; soul se carga en 29-text-decoration.tex). Participa en el
 * hash de filters para invalidar las salidas cacheadas si cambia (state.ts).
 */
export const MD_READER = 'markdown+auto_identifiers+mark';

/**
 * Normaliza un valor string para `--metadata=clave:valor` de pandoc: los
 * saltos de línea se pliegan a espacios. Pandoc trata el resto de caracteres
 * (comillas, dos puntos, llaves) como literales dentro del valor y no pueden
 * inyectar claves ni romper el parseo (un solo elemento de argv); el plegado
 * explícito hace el comportamiento determinista.
 */
export function metadataValue(value: string): string {
  return value.replace(/\n/g, ' ');
}

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
export type FormatKey = 'pdf' | 'epub' | 'latex' | 'markdown';

export interface FormatsLink {
  href: string;
  /** Clave canónica: resuelve el icono sin depender del nombre visible. */
  key: FormatKey;
  /** Nombre visible (PDF, EPUB, LaTeX, Markdown). */
  name: string;
  description: string;
}

/** Iconos SVG de los formatos (trazo geométrico, mismo lenguaje del logo). */
const FORMAT_ICONS: Record<FormatKey, string> = {
  pdf: '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h4M10 15h4"/></svg>',
  epub: '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z"/><path d="M12 6v14"/></svg>',
  latex:
    '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14"/><path d="M5 4l1.5 2M19 4l-1.5 2"/><path d="M12 4v16"/><path d="M8.5 20h7"/></svg>',
  markdown:
    '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14M5 10h10M5 14h14M5 18h8"/></svg>',
};

/** Clase de los títulos-chip de las tarjetas (se usa en formatos y referencias). */
const CHIP_CLASS =
  'inline-block align-top rounded-full border border-accent-500/40 bg-accent-500/15 px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none mt-0 mb-12 text-accent-600 dark:text-accent-400';

/**
 * Genera el bloque de la tarjeta Formatos (enlaces a los formatos generados)
 * con su marcador. Sin formatos activos no se genera nada: el bloque queda
 * ausente y el resto del masonry no se altera. El resultado se pasa al
 * template como variable `formats`.
 */
export function buildFormatsBlock(formats: FormatsLink[]): string | undefined {
  if (formats.length === 0) return undefined;

  const items = formats
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

  const chipClass = CHIP_CLASS;
  return (
    `<div class="break-inside-avoid pb-6">\n` +
    `      <section class="relative [&::before]:pointer-events-none [&::before]:absolute [&::before]:left-2 [&::before]:top-2 [&::before]:h-3 [&::before]:w-3 [&::before]:border-l [&::before]:border-t [&::before]:border-accent-500/30 [&::before]:content-[''] [&::after]:pointer-events-none [&::after]:absolute [&::after]:bottom-2 [&::after]:right-2 [&::after]:h-3 [&::after]:w-3 [&::after]:border-b [&::after]:border-r [&::after]:border-accent-500/30 [&::after]:content-[''] rounded-xl border border-accent-500/25 bg-stone-50/70 dark:bg-stone-900/60 p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5">\n` +
    `        <h2 class="${chipClass}">Formatos</h2>\n` +
    `        <ul class="list-none m-0 p-0 space-y-3">\n` +
    items +
    `\n        </ul>\n` +
    `      </section>\n` +
    `    </div>`
  );
}

/**
 * Elimina del TOC el ítem que enlaza a #refs-heading (el header sintético que
 * inyecta el filtro internal/flags para link-citations; sin él, el TOC lo
 * incluiría). El ítem es el último li del TOC y no contiene sublistas
 * (header de nivel 1).
 */
export function removeTocReferencesLink(html: string): string {
  return html.replace(/<li>\s*<a href="#refs-heading"[^>]*>.*?<\/a>\s*<\/li>/gs, '');
}

/**
 * Extrae el bloque de referencias (h1#refs-heading + div#refs) del article y lo
 * devuelve como bloque del masonry con su marcador. El id del heading es el
 * sintético que inyecta internal/flags.lua: un heading "Referencias" propio
 * del documento (id referencias) nunca se toca. El parse del cierre es
 * balanceado: las entradas csl-entry son divs anidados, el primer `</div>` no
 * cierra el bloque. Sin citas, no se genera bloque.
 */
export function extractReferencesBlock(html: string): { html: string; block?: string } {
  const refsIdPos = html.indexOf('id="refs-heading"');
  const refsDivPos = html.indexOf('<div id="refs"');
  if (refsIdPos < 0 && refsDivPos < 0) return { html };

  const start = refsIdPos >= 0 ? html.lastIndexOf('<h1', refsIdPos) : refsDivPos;
  const divStart = html.indexOf('<div id="refs"', start);
  if (divStart < 0) {
    if (html.includes('<!-- block:referencias -->')) {
      // Heading sintético sin div#refs (citeproc sin entradas): eliminar el
      // heading y el marcador, sin tocar ningún heading del documento.
      if (refsIdPos >= 0 && start >= 0) {
        const h1End = html.indexOf('</h1>', start);
        if (h1End >= 0) html = html.slice(0, start) + html.slice(h1End + 5);
      }
      return { html: html.replace('<!-- block:referencias -->', '') };
    }
    return { html };
  }

  let depth = 0;
  let i = divStart;
  while (i < html.length) {
    const open = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      depth++;
      i = open + 4;
    } else {
      depth--;
      i = close + 6;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return { html };
  const end = i;

  const block = html.slice(start, end);
  const withoutBlock = html.slice(0, start) + html.slice(end);

  const chipClass = CHIP_CLASS;
  const styledHeading = block.replace(/<h1[^>]*id="refs-heading"[^>]*>/, `<h2 id="refs-heading" class="${chipClass}">`).replace('</h1>', '</h2>');
  const card =
    `<div class="break-inside-avoid pb-6">\n` +
    `      <section class="relative [&::before]:pointer-events-none [&::before]:absolute [&::before]:left-2 [&::before]:top-2 [&::before]:h-3 [&::before]:w-3 [&::before]:border-l [&::before]:border-t [&::before]:border-accent-500/30 [&::before]:content-[''] [&::after]:pointer-events-none [&::after]:absolute [&::after]:bottom-2 [&::after]:right-2 [&::after]:h-3 [&::after]:w-3 [&::after]:border-b [&::after]:border-r [&::after]:border-accent-500/30 [&::after]:content-[''] rounded-xl border border-accent-500/25 bg-stone-50/80 dark:bg-stone-900/70 p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [&_.csl-entry]:mb-3 [&_.csl-entry]:pl-4 [&_.csl-entry]:-indent-4">\n` +
    `        ${styledHeading}\n` +
    `      </section>\n` +
    `    </div>`;

  return { html: withoutBlock, block: card };
}
