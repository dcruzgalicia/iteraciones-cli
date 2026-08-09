import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { type BibOptions, runPandoc } from '../lib/pandoc-runner.js';
import { splitFrontmatter } from './discover.js';
import { assembleHtmlBlocks, blockMarker } from './html-blocks.js';
import type { BuildDocument, PreambleFlags } from './types.js';

// ---------------------------------------------------------------------------
// Sistema de filters por capas: filtros Lua que corren dentro de pandoc.
//   semantic/string y semantic/ast: en markdown → json (AST canónico).
//   latex/ y html/: en cada exportación (json → latex, json → html5).
//
// Pipeline:
//   markdown → pandoc --to json [--lua-filter semantic/*] → AST canónico
//     → pandoc --from json --to latex [--lua-filter latex/*] → tex
//     → pandoc --from json --to html5 [--lua-filter html/*] → página HTML

/** Raíz de los filtros Lua del paquete. */
const LUA_FILTERS_ROOT = join(import.meta.dir, '../lib/resources/filters');

/** Capas de filtros Lua del paquete: directorio → grupo de resolución. */
const LUA_GROUPS: Array<{ dir: string; target: 'semantic' | 'latex' | 'html' }> = [
  { dir: 'semantic/string', target: 'semantic' },
  { dir: 'semantic/ast', target: 'semantic' },
  { dir: 'latex', target: 'latex' },
  { dir: 'html', target: 'html' },
];

/** Filtros Lua resueltos por capa (rutas absolutas, en orden de aplicación). */
interface LuaFilterGroup {
  semantic: string[];
  latex: string[];
  html: string[];
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
  const result: LuaFilterGroup = { semantic: [], latex: [], html: [], user: [], resolvedNames: new Set() };

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
 * Resuelve los filtros Lua por capa: los nombres con un .lua disponible
 * (paquete o override del proyecto) se pasan como `--lua-filter` en la
 * invocación pandoc de su capa. Incluye los filtros de usuario
 * (`lua-filters:`), que corren en todas las invocaciones.
 * @param disabledList Lista de filters a desactivar (nombres completos). undefined = todos activos.
 * @param cwd Directorio del proyecto para buscar overrides.
 */
export async function loadFilterGroups(siteConfig: SiteConfig, disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const group = await resolveLuaFilters(disabledList, cwd);
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
 * La descripción se toma de la primera línea de comentario `-- ...` del archivo.
 */
export async function getBuiltinLuaFilterInfos(): Promise<LuaFilterInfo[]> {
  const infos: LuaFilterInfo[] = [];
  if (!(await dirExists(LUA_FILTERS_ROOT))) return infos;
  const glob = new Bun.Glob('**/*.lua');
  for await (const rel of glob.scan({ cwd: LUA_FILTERS_ROOT, onlyFiles: true })) {
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

function isHeader(block: unknown): boolean {
  return typeof block === 'object' && block !== null && (block as Record<string, unknown>).t === 'Header';
}

/** Comandos de sección LaTeX reconocidos como inicio de documento. */
const SECTION_COMMAND_RE = /^\\(subsubsection|subsection|section|subparagraph|paragraph|chapter|part)\*?(?:\[|\{|\s*$)/;

/**
 * Detecta un RawBlock LaTeX que sea un comando de sección (`\chapter{...}`,
 * `\section*{...}`, etc.) escrito directamente en markdown. Pandoc lo
 * representa como RawBlock, no como Header, pero tipográficamente inicia
 * una sección y debe tratarse igual.
 */
function isSectionRawBlock(block: unknown): boolean {
  if (typeof block !== 'object' || block === null) return false;
  const b = block as Record<string, unknown>;
  if (b.t !== 'RawBlock') return false;
  const c = b.c as unknown[];
  // pandoc usa 'tex' para raw TeX en markdown y 'latex' en otros contextos
  if (!Array.isArray(c) || (c[0] !== 'tex' && c[0] !== 'latex') || typeof c[1] !== 'string') return false;
  return SECTION_COMMAND_RE.test(c[1].trim());
}

/** BlockQuote nativo de markdown (`> cita`), que pandoc convierte a \begin{quote} en LaTeX. */
function isBlockQuote(block: unknown): boolean {
  return typeof block === 'object' && block !== null && (block as Record<string, unknown>).t === 'BlockQuote';
}

function isDivWithClass(block: unknown, cls: string): boolean {
  if (typeof block !== 'object' || block === null) return false;
  const b = block as Record<string, unknown>;
  if (b.t !== 'Div') return false;
  const c = b.c as unknown[];
  if (!Array.isArray(c) || c.length < 1) return false;
  const attrs = c[0] as unknown[];
  if (!Array.isArray(attrs) || attrs.length < 2) return false;
  const classes = attrs[1] as string[];
  return Array.isArray(classes) && classes.includes(cls);
}

/**
 * Calcula los flags de preámbulo desde el AST canónico (después de los
 * filters semánticos, sin contenido de formato). Reemplaza la detección
 * por regex/startsWith sobre el LaTeX.
 */
export function computePreambleFlags(ast: Record<string, unknown>): PreambleFlags {
  const blocks = ast.blocks as unknown[];
  const list = Array.isArray(blocks) ? blocks : [];
  const first = list[0];
  const isSectionStart = isHeader(first) || isSectionRawBlock(first);
  // dictum, verse y quote (Div o BlockQuote nativo) abren entornos list
  const isDictumStart = isDivWithClass(first, 'dictum') || isDivWithClass(first, 'verse') || isDivWithClass(first, 'quote') || isBlockQuote(first);
  return {
    hasTocEntries: list.some(isHeader) || list.some(isSectionRawBlock),
    skipNoIndent: isSectionStart || isDictumStart,
    skipParagraphSpace: isSectionStart || isDictumStart,
  };
}

/** Retorna true si el AST contiene nodos Cite (citas con bibliografía). */
export function hasCiteNodes(ast: Record<string, unknown>): boolean {
  return walkAst(ast, (node) => typeof node === 'object' && node !== null && (node as Record<string, unknown>).t === 'Cite');
}

/**
 * Camina un árbol de nodos (AST de pandoc) aplicando un predicado.
 * Evita serializar el AST a string (JSON.stringify) solo para buscar un nodo.
 */
function walkAst(node: unknown, predicate: (node: unknown) => boolean): boolean {
  if (predicate(node)) return true;
  if (Array.isArray(node)) {
    return node.some((item) => walkAst(item, predicate));
  }
  if (typeof node === 'object' && node !== null) {
    return Object.values(node as Record<string, unknown>).some((value) => walkAst(value, predicate));
  }
  return false;
}

/** Convierte el AST canónico a body LaTeX aplicando los filtros Lua de la capa latex. */
async function renderTexBody(
  ast: Record<string, unknown>,
  doc: BuildDocument,
  bibFiles: string[],
  hasCiteKeys: boolean,
  luaFilters: string[],
  userFilters: string[],
): Promise<string> {
  const pandocArgs: string[] = ['--top-level-division', 'section', '--shift-heading-level-by=2'];
  // Filtros de usuario primero: pueden transformar los nodos semánticos antes de la capa latex
  for (const filter of [...userFilters, ...luaFilters]) {
    pandocArgs.push('--lua-filter', filter);
  }
  if (bibFiles.length > 0) {
    pandocArgs.push('--biblatex');
    for (const bib of bibFiles) {
      pandocArgs.push('--bibliography', bib);
    }
  }
  let processedBody = await runPandoc({ input: JSON.stringify(ast), sourcePath: doc.filePath, from: 'json', to: 'latex', extraArgs: pandocArgs });
  if (bibFiles.length > 0 && hasCiteKeys) {
    processedBody = `${processedBody.replace(/\n+$/, '\n\n')}\\printbibliography[heading=bibintoc]\n`;
  }
  return processedBody;
}

/** Ruta de la plantilla HTML (template system de pandoc). */
const HTML_TEMPLATE_PATH = join(import.meta.dir, '../../src/lib/resources/template.html');

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

/**
 * Reader de markdown con auto-identifiers activos: los headings llevan `id`
 * y el TOC puede generar enlaces `#`. Participa en el hash de filters para
 * invalidar los ASTs cacheados si cambia (ver state.ts).
 */
export const MD_READER = 'markdown+auto_identifiers';

/** Id y título de la sección de referencias (citeproc). */
const REFERENCES_HEADING_ID = 'referencias';
const REFERENCES_HEADING_TEXT = 'Referencias';

/**
 * Clona el AST agregando al final el heading de referencias (nivel 1).
 * Citeproc lo necesita para enlazar las citas del texto (link-citations) y
 * deja el h1 justo antes del div#refs; el ítem que genera en el TOC se
 * elimina en el post-procesamiento (removeTocReferencesLink).
 */
function withReferencesHeading(ast: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(ast)) as Record<string, unknown>;
  const blocks = Array.isArray(clone.blocks) ? (clone.blocks as unknown[]) : [];
  blocks.push({
    t: 'Header',
    c: [1, [REFERENCES_HEADING_ID, [], []], [{ t: 'Str', c: REFERENCES_HEADING_TEXT }]],
  });
  clone.blocks = blocks;
  return clone;
}

/**
 * Elimina del TOC el ítem que enlaza a #referencias (el header sintético que
 * citeproc necesita para link-citations; sin él, el TOC lo incluiría). El
 * ítem es el último li del TOC y no contiene sublistas (header de nivel 1).
 */
function removeTocReferencesLink(html: string): string {
  return html.replace(/<li>\s*<a href="#referencias"[^>]*>.*?<\/a>\s*<\/li>/gs, '');
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
 * ausente y el resto del masonry no se altera.
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
    blockMarker('formatos') +
    '\n' +
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
 * Extrae el bloque de referencias (h1#referencias + div#refs) del article y lo
 * devuelve como bloque del masonry con su marcador. El parse del cierre es
 * balanceado: las entradas csl-entry son divs anidados, el primer `</div>` no
 * cierra el bloque. Sin citas, no se genera bloque.
 */
function extractReferencesBlock(html: string): { html: string; block?: string } {
  const refsIdPos = html.indexOf('id="referencias"');
  const refsDivPos = html.indexOf('<div id="refs"');
  if (refsIdPos < 0 && refsDivPos < 0) return { html };

  const start = refsIdPos >= 0 ? html.lastIndexOf('<h1', refsIdPos) : refsDivPos;
  const divStart = html.indexOf('<div id="refs"', start);
  if (divStart < 0) return { html };

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
    blockMarker('referencias') +
    '\n' +
    `<div class="break-inside-avoid pb-6">\n` +
    `      <section class="relative [&::before]:pointer-events-none [&::before]:absolute [&::before]:left-2 [&::before]:top-2 [&::before]:h-3 [&::before]:w-3 [&::before]:border-l [&::before]:border-t [&::before]:border-accent-500/30 [&::before]:content-[''] [&::after]:pointer-events-none [&::after]:absolute [&::after]:bottom-2 [&::after]:right-2 [&::after]:h-3 [&::after]:w-3 [&::after]:border-b [&::after]:border-r [&::after]:border-accent-500/30 [&::after]:content-[''] rounded-xl border border-accent-500/25 bg-stone-50/80 dark:bg-stone-900/70 p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [&_.csl-entry]:mb-3 [&_.csl-entry]:pl-4 [&_.csl-entry]:-indent-4">\n` +
    `        ${styledHeading}\n` +
    `      </section>\n` +
    `    </div>`;

  return { html: withoutBlock, block: card };
}

/**
 * Genera la página HTML completa desde el AST canónico con el template
 * system de pandoc (`--template template.html`), aplicando los filtros Lua
 * de la capa html a los nodos semánticos dentro de la misma invocación.
 */
export async function renderHtmlPageFromAst(
  ast: Record<string, unknown>,
  doc: BuildDocument,
  cwd: string,
  vars: HtmlPageVars,
  siteConfig: SiteConfig,
  bibOptions?: BibOptions,
  luaFilters?: LuaFilterGroup,
): Promise<string> {
  const filters = luaFilters ?? (await loadFilterGroups(siteConfig, siteConfig.disabledFilters, cwd));

  const extraArgs = [
    '--template',
    HTML_TEMPLATE_PATH,
    `--metadata=title:${metadataValue(vars.title)}`,
    `--metadata=site-title:${metadataValue(vars.siteTitle)}`,
    `--metadata=lang:${vars.lang}`,
    // Las citas del texto enlazan a sus entradas en la tarjeta de referencias
    '--metadata=link-citations:true',
  ];
  if (siteConfig.toc) extraArgs.push('--toc');
  // Filtros de usuario primero, luego la capa html
  for (const filter of [...filters.user, ...filters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (vars.tagline) extraArgs.push(`--metadata=tagline:${metadataValue(vars.tagline)}`);
  if (vars.docTitle) extraArgs.push(`--metadata=doc-title:${metadataValue(vars.docTitle)}`);
  if (vars.subtitle) extraArgs.push(`--metadata=subtitle:${metadataValue(vars.subtitle)}`);
  if (vars.date) extraArgs.push(`--metadata=date:${metadataValue(vars.date)}`);
  if (vars.homeHref) extraArgs.push(`--metadata=home-href:${vars.homeHref}`);
  if (vars.theme) extraArgs.push(`--metadata=theme:${vars.theme}`);
  if (vars.accent) extraArgs.push(`--metadata=accent:${vars.accent}`);
  if (vars.css) extraArgs.push(`--metadata=css:${vars.css}`);
  if (vars.authorMeta) extraArgs.push(`--metadata=author-meta:${vars.authorMeta}`);
  // -V (template variable): se inserta cruda, sin escape HTML (el logo es SVG)
  if (vars.logoInline) extraArgs.push(`--variable=logo-inline:${vars.logoInline}`);

  // Sección de referencias: si hay citas y bibliografía, el AST HTML lleva un
  // heading h1 'Referencias' (id referencias) justo antes del div#refs que
  // citeproc inserta — necesario para que link-citations enlace las citas del
  // texto. El AST canónico no se modifica (LaTeX/EPUB/Markdown intactos).
  const inputAst = bibOptions?.bibliography && hasCiteNodes(ast) ? withReferencesHeading(ast) : ast;
  const html = await runPandoc({ input: JSON.stringify(inputAst), sourcePath: doc.filePath, from: 'json', to: 'html5', bibOptions, extraArgs });

  // El TOC incluiría el ítem 'Referencias' (el header sintético): se elimina.
  const htmlWithoutTocRefs = removeTocReferencesLink(html);

  // Post-procesamiento: las referencias salen del article y se convierten en
  // un bloque del masonry; la tarjeta Formatos es otro bloque generado. Ambos
  // se ordenan junto con los bloques del template (header, trayectura, indice,
  // footer) según format.html.blocks (sistema de bloques: sin anclas de texto).
  const { html: htmlWithoutRefs, block: referencesBlock } = extractReferencesBlock(htmlWithoutTocRefs);
  const formatsBlock = buildFormatsBlock(vars.formats ?? []);
  return assembleHtmlBlocks(htmlWithoutRefs, { formatos: formatsBlock, referencias: referencesBlock }, siteConfig.format?.html?.blocks);
}

/**
 * Genera el AST canónico desde el markdown de un documento (sin frontmatter),
 * aplicando los filtros semánticos (string + ast) y los de usuario.
 * Lanza BuildError con la ruta del documento si el archivo no se puede leer,
 * el body está vacío o pandoc devuelve JSON inválido: un documento que falla
 * aborta el build (nunca se omite en silencio ni se publica contenido stale).
 */
export async function markdownToAst(
  doc: BuildDocument,
  cwd: string,
  siteConfig: SiteConfig,
  luaFilters?: LuaFilterGroup,
): Promise<Record<string, unknown>> {
  const filters = luaFilters ?? (await loadFilterGroups(siteConfig, siteConfig.disabledFilters, cwd));

  // Leer body del disco sin frontmatter (parser compartido con discovery)
  let body = '';
  try {
    body = splitFrontmatter(await Bun.file(doc.filePath).text()).body;
  } catch (err) {
    throw new BuildError(`no se pudo leer "${doc.filePath}": ${String(err)}`);
  }
  if (!body.trim()) {
    throw new BuildError(`"${doc.filePath}" no tiene contenido después del frontmatter`);
  }

  // Convertir markdown a JSON AST con los filtros Lua semánticos + de usuario
  const semanticLuaArgs = [...filters.semantic, ...filters.user].flatMap((f) => ['--lua-filter', f]);
  const json = await runPandoc({
    input: body,
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'json',
    extraArgs: semanticLuaArgs,
  });
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new BuildError(`pandoc devolvió un AST JSON inválido para "${doc.filePath}"`);
  }
}

/**
 * Genera el cuerpo LaTeX + flags de preámbulo desde el AST canónico.
 * Los archivos .bib se resuelven una sola vez por build (ver pipeline) y se
 * pasan aquí: la detección de citas corre sobre el AST, sin re-descubrir
 * la bibliografía por documento.
 */
export async function texBodyFromAst(
  ast: Record<string, unknown>,
  doc: BuildDocument,
  filters: LuaFilterGroup,
  bibFiles: string[],
): Promise<{ body: string; flags: PreambleFlags }> {
  const flags = computePreambleFlags(ast);
  // Detección de citas desde el AST (nodos Cite reales, sin regex sobre el markdown)
  const hasCiteKeys = bibFiles.length > 0 && hasCiteNodes(ast);
  const body = await renderTexBody(ast, doc, bibFiles, hasCiteKeys, filters.latex, filters.user);
  return { body, flags };
}
