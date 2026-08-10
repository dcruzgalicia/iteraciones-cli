import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { type BibOptions, runPandoc } from '../lib/pandoc-runner.js';
import { splitFrontmatter } from './discover.js';
import { type ReproCtx, writeHtmlReproScript, writeLatexReproScripts } from './repro.js';
import type { BuildDocument } from './types.js';

// ---------------------------------------------------------------------------
// Sistema de filters por capas: filtros Lua que corren dentro de pandoc.
//   semantic/string y semantic/ast: en cada conversión, sobre el markdown
//     de entrada (dejan el contenido semántico sin formato específico).
//   internal/flags: filtro interno de detección estructural (preámbulo LaTeX
//     y heading de referencias HTML); no es un filter de usuario.
//   latex/ y html/: en cada exportación (markdown → latex, markdown → html5).
//
// Pipeline:
//   markdown → pandoc --to latex [--lua-filter semantic/*, user, flags, latex/*]
//            → pandoc --to html5 [--lua-filter semantic/*, user, flags, html/*]
//            → pandoc --to epub3/markdown [--lua-filter semantic/*, user]
//   No hay AST intermedio: cada conversión es una invocación directa de pandoc
//   desde el markdown original, con el template efectivo compuesto por el CLI.
// ---------------------------------------------------------------------------

/** Raíz de los filtros Lua del paquete. */
const LUA_FILTERS_ROOT = join(import.meta.dir, '../lib/resources/filters');

/** Filtro interno de detección estructural (flags de preámbulo y referencias). */
const FLAGS_FILTER = join(LUA_FILTERS_ROOT, 'internal', 'flags.lua');

/** Capas de filtros Lua del paquete: directorio → grupo de resolución. */
const LUA_GROUPS: Array<{ dir: string; target: 'semantic' | 'latex' | 'html' }> = [
  { dir: 'semantic/string', target: 'semantic' },
  { dir: 'semantic/ast', target: 'semantic' },
  { dir: 'latex', target: 'latex' },
  { dir: 'html', target: 'html' },
];

/** Filtros Lua resueltos por capa (rutas absolutas, en orden de aplicación). */
export interface LuaFilterGroup {
  semantic: string[];
  latex: string[];
  html: string[];
  /** Filtro interno de detección estructural (flags), en pasadas latex/html. */
  flags: string[];
  /** Filtros Lua de usuario (`lua-filters:` del proyecto), corren en todas las invocaciones. */
  user: string[];
  /** Nombres completos resueltos como .lua (los .ts equivalentes se omiten). */
  resolvedNames: Set<string>;
}

/** Resuelve el .lua de un filter: override del proyecto gana sobre el paquete. */
async function resolveLuaFilter(group: string, name: string, cwd?: string): Promise<string | undefined> {
  if (cwd) {
    const projectPath = join(cwd, 'filters', group, `${name}.lua`);
    if (await Bun.file(projectPath).exists()) return projectPath;
  }
  const pkgPath = join(LUA_FILTERS_ROOT, group, `${name}.lua`);
  return (await Bun.file(pkgPath).exists()) ? pkgPath : undefined;
}

/**
 * Nombres de los .lua de una capa del paquete, en orden de aplicación
 * (el prefijo numérico del archivo define el orden). Derivado del
 * filesystem: crear un .lua nuevo no requiere tocar código.
 */
function builtinNamesForGroup(dir: string): string[] {
  return [...new Bun.Glob('*.lua').scanSync({ cwd: join(LUA_FILTERS_ROOT, dir), onlyFiles: true })].sort().map((file) => file.replace(/\.lua$/, ''));
}

/**
 * Resuelve los filtros Lua por capa: los nombres con un .lua disponible
 * (paquete o override del proyecto) se pasan como `--lua-filter` en la
 * invocación pandoc de su capa.
 */
export async function resolveLuaFilters(disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const excluded = new Set(disabledList ?? []);
  const result: LuaFilterGroup = { semantic: [], latex: [], html: [], flags: [], user: [], resolvedNames: new Set() };

  for (const { dir, target } of LUA_GROUPS) {
    for (const name of builtinNamesForGroup(dir)) {
      const full = `${dir}/${name}`;
      if (excluded.has(full)) continue;
      const path = await resolveLuaFilter(dir, name, cwd);
      if (!path) continue;
      result[target].push(path);
      result.resolvedNames.add(full);
    }
  }
  return result;
}

/** Nombres completos (grupo/nombre) de todos los filters built-in del paquete. */
export function getBuiltinFilterNames(): string[] {
  const names: string[] = [];
  for (const { dir } of LUA_GROUPS) {
    for (const name of builtinNamesForGroup(dir)) {
      names.push(`${dir}/${name}`);
    }
  }
  return names;
}

/** Retorna el nombre completo que termina en "/<name>", si existe. */
export function suggestFilterName(name: string): string | undefined {
  return getBuiltinFilterNames().find((n) => n.endsWith(`/${name}`));
}

/**
 * Valida los nombres de `disabled-filters` contra los filters built-in.
 * Los nombres desconocidos (p. ej. configs con nombres incompletos) emiten un
 * warning con la sugerencia, sin romper el build.
 */
export function validateDisabledFilters(disabled: string[] | undefined): void {
  if (!disabled || disabled.length === 0) return;
  for (const name of disabled) {
    if (getBuiltinFilterNames().includes(name)) continue;
    const suggestion = suggestFilterName(name);
    logWarning(
      suggestion
        ? `disabled-filters: "${name}" no existe; ¿quisiste decir "${suggestion}"?`
        : `disabled-filters: "${name}" no coincide con ningún filter`,
      'config',
    );
  }
}

/**
 * Resuelve los filtros Lua de usuario (`lua-filters:` en iteraciones.config.yaml,
 * rutas relativas al proyecto). Las rutas inexistentes emiten un warning sin
 * romper el build.
 */
export async function resolveUserLuaFilters(cwd: string, siteConfig: SiteConfig): Promise<string[]> {
  const filters = siteConfig.luaFilters ?? [];
  const resolved: string[] = [];
  for (const rel of filters) {
    const abs = join(cwd, rel);
    if (await Bun.file(abs).exists()) {
      resolved.push(abs);
    } else {
      logWarning(`lua-filters: "${rel}" no encontrado en el proyecto`, 'config');
    }
  }
  return resolved;
}

/**
 * Resuelve los filtros Lua por capa, incluyendo el filtro interno de flags
 * y los filtros de usuario (`lua-filters:`), que corren en todas las
 * invocaciones.
 */
export async function loadFilterGroups(siteConfig: SiteConfig, disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const group = await resolveLuaFilters(disabledList, cwd);
  group.flags = [FLAGS_FILTER];
  group.user = cwd ? await resolveUserLuaFilters(cwd, siteConfig) : [];
  return group;
}

/** Información de un filtro Lua built-in para el CLI. */
export interface LuaFilterInfo {
  name: string;
  description: string;
}

/** Retorna true si la ruta es un directorio existente. */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Escanea los filtros Lua built-in del paquete (`lib/resources/filters`).
 * El directorio internal/ (filtros del pipeline, no de usuario) se excluye.
 * La descripción se toma de la primera línea de comentario `-- ...` del archivo.
 */
export async function getBuiltinLuaFilterInfos(): Promise<LuaFilterInfo[]> {
  const infos: LuaFilterInfo[] = [];
  if (!(await dirExists(LUA_FILTERS_ROOT))) return infos;
  const glob = new Bun.Glob('**/*.lua');
  for await (const rel of glob.scan({ cwd: LUA_FILTERS_ROOT, onlyFiles: true })) {
    if (rel.startsWith('internal/')) continue;
    const group = dirname(rel);
    const full = `${group}/${basename(rel, '.lua')}`;
    const content = await Bun.file(join(LUA_FILTERS_ROOT, rel)).text();
    infos.push({ name: full, description: readLuaDescription(content) });
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lee la descripción de un filter Lua: une las líneas de comentario iniciales
 * (`-- ...`) en una sola frase. Se detiene en la primera línea de código o en
 * una línea de "Uso: ..." (instrucciones de invocación, no descripción).
 */
function readLuaDescription(content: string): string {
  const lines: string[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('--')) {
      const text = line.replace(/^--\s*/, '').trim();
      if (text.startsWith('Uso:')) break;
      lines.push(text);
    } else if (lines.length > 0) {
      break;
    }
  }
  return lines.join(' ');
}

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
 * Reader de markdown con auto-identifiers activos: los headings llevan `id`
 * y el TOC puede generar enlaces `#`. Participa en el hash de filters para
 * invalidar las salidas cacheadas si cambia (ver state.ts).
 */
export const MD_READER = 'markdown+auto_identifiers';

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
interface HtmlPageVars {
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

interface FormatsLink {
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

/**
 * Genera el bloque de la tarjeta Formatos (enlaces a los formatos generados)
 * con su marcador. Sin formatos activos no se genera nada: el bloque queda
 * ausente y el resto del masonry no se altera. El resultado se pasa al
 * template como variable `formats`.
 */
function buildFormatsBlock(formats: FormatsLink[]): string | undefined {
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

  const chipClass =
    'inline-block align-top rounded-full border border-accent-500/40 bg-accent-500/15 px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none mt-0 mb-12 text-accent-600 dark:text-accent-400';
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
 * Elimina del TOC el ítem que enlaza a #referencias (el header sintético que
 * inyecta el filtro internal/flags para link-citations; sin él, el TOC lo
 * incluiría). El ítem es el último li del TOC y no contiene sublistas
 * (header de nivel 1).
 */
export function removeTocReferencesLink(html: string): string {
  return html.replace(/<li>\s*<a href="#referencias"[^>]*>.*?<\/a>\s*<\/li>/gs, '');
}

/**
 * Extrae el bloque de referencias (h1#referencias + div#refs) del article y lo
 * devuelve como bloque del masonry con su marcador. El parse del cierre es
 * balanceado: las entradas csl-entry son divs anidados, el primer `</div>` no
 * cierra el bloque. Sin citas, no se genera bloque.
 */
export function extractReferencesBlock(html: string): { html: string; block?: string } {
  const refsIdPos = html.indexOf('id="referencias"');
  const refsDivPos = html.indexOf('<div id="refs"');
  if (refsIdPos < 0 && refsDivPos < 0) return { html };

  const start = refsIdPos >= 0 ? html.lastIndexOf('<h1', refsIdPos) : refsDivPos;
  const divStart = html.indexOf('<div id="refs"', start);
  if (divStart < 0) {
    // El marcador solo se renderiza si el filtro internal/flags detectó citas
    // y bibliografía: si está presente pero citeproc no generó div#refs (citas
    // sin entrada en la bibliografía), el heading sintético queda huérfano
    // dentro del article y se elimina (no hay nada que mostrar). Sin marcador
    // el heading es del autor: no se toca.
    if (html.includes('<!-- block:referencias -->')) {
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
  if (depth !== 0) return { html }; // HTML inesperado: no tocar
  const end = i;

  const block = html.slice(start, end);
  const withoutBlock = html.slice(0, start) + html.slice(end);

  // Título de la tarjeta: chip como el resto de las tarjetas (Trayectura/Índice).
  // Se conserva el id referencias.
  const chipClass =
    'inline-block align-top rounded-full border border-accent-500/40 bg-accent-500/15 px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none mt-0 mb-12 text-accent-600 dark:text-accent-400';
  const styledHeading = block.replace(/<h1[^>]*id="referencias"[^>]*>/, `<h2 id="referencias" class="${chipClass}">`).replace('</h1>', '</h2>');
  const card =
    `<div class="break-inside-avoid pb-6">\n` +
    `      <section class="relative [&::before]:pointer-events-none [&::before]:absolute [&::before]:left-2 [&::before]:top-2 [&::before]:h-3 [&::before]:w-3 [&::before]:border-l [&::before]:border-t [&::before]:border-accent-500/30 [&::before]:content-[''] [&::after]:pointer-events-none [&::after]:absolute [&::after]:bottom-2 [&::after]:right-2 [&::after]:h-3 [&::after]:w-3 [&::after]:border-b [&::after]:border-r [&::after]:border-accent-500/30 [&::after]:content-[''] rounded-xl border border-accent-500/25 bg-stone-50/80 dark:bg-stone-900/70 p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [&_.csl-entry]:mb-3 [&_.csl-entry]:pl-4 [&_.csl-entry]:-indent-4">\n` +
    `        ${styledHeading}\n` +
    `      </section>\n` +
    `    </div>`;

  return { html: withoutBlock, block: card };
}

/**
 * Genera la página HTML completa desde el markdown original en una sola
 * invocación de pandoc (reader markdown + filtros semánticos/de usuario/flags
 * + capa html + template efectivo). Post-procesamiento mínimo: solo las
 * referencias (extraerlas del article y reinsertarlas en su marcador, que es
 * la única forma de sacarlas del body correctamente).
 */
export async function htmlPageFromMarkdown(
  content: string,
  doc: BuildDocument,
  cwd: string,
  vars: HtmlPageVars,
  siteConfig: SiteConfig,
  templatePath: string,
  fm: Record<string, unknown>,
  bibOptions?: BibOptions,
  luaFilters?: LuaFilterGroup,
  repro?: ReproCtx,
): Promise<string> {
  const filters = luaFilters ?? (await loadFilterGroups(siteConfig, siteConfig.disabledFilters, cwd));
  // Valores efectivos: el frontmatter del documento manda; la config aporta defaults
  const lang = typeof fm.lang === 'string' && fm.lang ? fm.lang : vars.lang;
  const siteTitle = typeof fm['site-title'] === 'string' && fm['site-title'] ? (fm['site-title'] as string) : vars.siteTitle;
  const tagline = typeof fm.tagline === 'string' && fm.tagline ? (fm.tagline as string) : vars.tagline;
  const theme = typeof fm.theme === 'string' && fm.theme ? (fm.theme as string) : vars.theme;
  const accent = typeof fm.accent === 'string' && fm.accent ? (fm.accent as string) : vars.accent;
  const css = typeof fm.css === 'string' && fm.css ? (fm.css as string) : vars.css;
  // El TOC: el frontmatter (toc:) manda; la config aporta el default
  const tocActive = typeof fm.toc === 'boolean' ? fm.toc : siteConfig.toc;

  const extraArgs = [
    '--template',
    templatePath,
    `--metadata=title:${metadataValue(vars.title)}`,
    `--metadata=site-title:${metadataValue(siteTitle)}`,
    `--metadata=lang:${lang}`,
    // Las citas del texto enlazan a sus entradas en la tarjeta de referencias
    '--metadata=link-citations:true',
  ];
  if (tocActive) extraArgs.push('--toc');
  // Filtros semánticos y de usuario primero, luego el filtro interno de flags
  // (heading sintético de referencias) y la capa html.
  for (const filter of [...filters.semantic, ...filters.user, ...filters.flags, ...filters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (tagline) extraArgs.push(`--metadata=tagline:${metadataValue(tagline)}`);
  if (vars.docTitle) extraArgs.push(`--metadata=doc-title:${metadataValue(vars.docTitle)}`);
  if (vars.subtitle) extraArgs.push(`--metadata=subtitle:${metadataValue(vars.subtitle)}`);
  if (vars.date) extraArgs.push(`--metadata=date:${metadataValue(vars.date)}`);
  if (vars.homeHref) extraArgs.push(`--metadata=home-href:${vars.homeHref}`);
  if (theme) extraArgs.push(`--metadata=theme:${theme}`);
  if (accent) extraArgs.push(`--metadata=accent:${accent}`);
  if (css) extraArgs.push(`--metadata=css:${css}`);
  if (vars.authorMeta) extraArgs.push(`--metadata=author-meta:${vars.authorMeta}`);
  // -V (template variable): se inserta cruda, sin escape HTML (el logo es SVG)
  if (vars.logoInline) extraArgs.push(`--variable=logo-inline:${vars.logoInline}`);
  // Tarjeta de formatos: HTML generado por el CLI (hrefs relativos por doc).
  const formatsBlock = buildFormatsBlock(vars.formats ?? []);
  if (formatsBlock) extraArgs.push(`--variable=formats:${formatsBlock}`);

  // citeproc se pasa DESPUÉS de los --lua-filter: el orden de los filtros en
  // argv determina el orden de aplicación, y el heading sintético de
  // referencias (internal/flags) debe quedar ANTES del div#refs que citeproc
  // inserta al final (si citeproc corre antes, div#refs queda después del
  // heading y el post-procesamiento no puede extraerlo).
  if (bibOptions) {
    extraArgs.push('--citeproc', '--bibliography', bibOptions.bibliography);
    if (bibOptions.csl) extraArgs.push('--csl', bibOptions.csl);
  }

  // El filtro internal/flags agrega el heading sintético de referencias solo
  // si hay citas y bibliografía (necesario para link-citations); el TOC lo
  // incluiría, así que el ítem se elimina en el post-procesamiento.
  const html = await runPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'html5', extraArgs });

  const htmlWithoutTocRefs = removeTocReferencesLink(html);

  // Post-procesamiento mínimo: las referencias salen del article y se
  // convierten en un bloque del masonry, insertado en su marcador (la única
  // posición que no puede resolver el template: no existen hasta que pandoc
  // las genera). Sin citas, el marcador no se renderiza ($if(has-references)$).
  const { html: htmlWithoutRefs, block: referencesBlock } = extractReferencesBlock(htmlWithoutTocRefs);
  if (referencesBlock) {
    if (repro) await writeHtmlReproScript(repro, doc, extraArgs);
    return htmlWithoutRefs.replace('<!-- block:referencias -->', referencesBlock);
  }
  if (repro) await writeHtmlReproScript(repro, doc, extraArgs);
  return htmlWithoutRefs;
}

/**
 * Genera el cuerpo LaTeX completo (.tex final: preámbulo + cuerpo) desde el
 * markdown original en una sola invocación de pandoc, con el template
 * efectivo compuesto por el CLI. El filtro internal/flags calcula los flags
 * del preámbulo (TOC, espaciado, \noindent) y agrega \printbibliography.
 */
export async function markdownToLatex(
  content: string,
  doc: BuildDocument,
  filters: LuaFilterGroup,
  bibFiles: string[],
  templatePath: string,
  vars: { title: string; subtitle?: string; author: string[]; date?: string },
  repro?: ReproCtx,
): Promise<string> {
  const extraArgs = ['--template', templatePath, '--top-level-division', 'section', '--shift-heading-level-by=2'];
  // Filtros semánticos y de usuario primero, luego flags y la capa latex
  for (const filter of [...filters.semantic, ...filters.user, ...filters.flags, ...filters.latex]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (bibFiles.length > 0) {
    extraArgs.push('--biblatex');
    for (const bib of bibFiles) {
      extraArgs.push('--bibliography', bib);
    }
  }
  extraArgs.push(`--metadata=title:${metadataValue(vars.title)}`);
  if (vars.subtitle) extraArgs.push(`--metadata=subtitle:${metadataValue(vars.subtitle)}`);
  for (const author of vars.author) {
    extraArgs.push(`--metadata=author:${metadataValue(author)}`);
  }
  // date: la fecha efectiva (formateada o birthtime); '' neutraliza el date del
  // frontmatter cuando show-date está desactivado (la portada no muestra fecha).
  if (vars.date !== undefined) extraArgs.push(`--metadata=date:${metadataValue(vars.date)}`);

  if (repro) await writeLatexReproScripts(repro, doc, extraArgs);

  return runPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'latex', extraArgs });
}

/** Lanza BuildError con la ruta del documento si el body no se puede leer. */
export async function readDocumentBody(doc: BuildDocument): Promise<string> {
  let content: string;
  try {
    content = await Bun.file(doc.filePath).text();
  } catch (err) {
    throw new BuildError(`no se pudo leer "${doc.filePath}": ${String(err)}`);
  }
  const { body } = splitFrontmatter(content);
  if (!body.trim()) {
    throw new BuildError(`"${doc.filePath}" no tiene contenido después del frontmatter`);
  }
  return body;
}
