import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { logWarning } from '../lib/logger.js';
import { type BibOptions, runPandoc } from '../lib/pandoc-runner.js';
import { mapWithConcurrency } from '../lib/run.js';
import { splitFrontmatter } from './discover.js';
import { resolveBibOptions } from './state.js';
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

/** Lista de filters semánticos string en orden de aplicación. */
const BUILTIN_SEMANTIC_STRING = ['01-double-colon'];

/** Lista de filters semánticos ast en orden de aplicación. */
const BUILTIN_SEMANTIC_AST = ['02-double-colon-noindent'];

/** Lista de filters de formato LaTeX en orden de aplicación. */
const BUILTIN_LATEX_FILTERS = ['01-spacer', '02-dictum', '03-verse', '04-center', '05-flushright', '06-mbox-sentence-end', '07-mbox-sentence-start'];

/** Lista de filters de formato HTML en orden de aplicación. */
const BUILTIN_HTML_FILTERS = ['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer'];

/** Raíz de los filtros Lua del paquete. */
const LUA_FILTERS_ROOT = join(import.meta.dir, '../lib/resources/filters');

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
 * Resuelve los filtros Lua por capa: los nombres con un .lua disponible
 * (paquete o override del proyecto) se pasan como `--lua-filter` en la
 * invocación pandoc de su capa.
 */
export async function resolveLuaFilters(disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const excluded = new Set(disabledList ?? []);
  const result: LuaFilterGroup = { semantic: [], latex: [], html: [], user: [], resolvedNames: new Set() };

  const groups: Array<{ prefix: string; names: string[]; target: 'semantic' | 'latex' | 'html' }> = [
    { prefix: 'semantic/string', names: BUILTIN_SEMANTIC_STRING, target: 'semantic' },
    { prefix: 'semantic/ast', names: BUILTIN_SEMANTIC_AST, target: 'semantic' },
    { prefix: 'latex', names: BUILTIN_LATEX_FILTERS, target: 'latex' },
    { prefix: 'html', names: BUILTIN_HTML_FILTERS, target: 'html' },
  ];

  for (const { prefix, names, target } of groups) {
    for (const name of names) {
      const full = `${prefix}/${name}`;
      if (excluded.has(full)) continue;
      const path = await resolveLuaFilter(prefix, name, cwd);
      if (!path) continue;
      result[target].push(path);
      result.resolvedNames.add(full);
    }
  }
  return result;
}

/** Nombres completos (grupo/nombre) de todos los filters built-in. */
function getBuiltinFilterNames(): string[] {
  return [
    ...BUILTIN_SEMANTIC_STRING.map((n) => `semantic/string/${n}`),
    ...BUILTIN_SEMANTIC_AST.map((n) => `semantic/ast/${n}`),
    ...BUILTIN_LATEX_FILTERS.map((n) => `latex/${n}`),
    ...BUILTIN_HTML_FILTERS.map((n) => `html/${n}`),
  ];
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
    const descLine = content.split('\n').find((l) => l.trim().startsWith('-- '));
    infos.push({ name: full, description: descLine?.replace(/^--\s*/, '').trim() ?? '' });
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
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
  // dictum y verse abren entornos list: no anteponer \noindent
  const isDictumStart = isDivWithClass(first, 'dictum') || isDivWithClass(first, 'verse');
  return {
    hasTocEntries: list.some(isHeader) || list.some(isSectionRawBlock),
    skipNoIndent: isSectionStart || isDictumStart,
    skipParagraphSpace: isSectionStart,
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
    `--metadata=title:${vars.title}`,
    `--metadata=site-title:${vars.siteTitle}`,
    `--metadata=lang:${vars.lang}`,
  ];
  // Filtros de usuario primero, luego la capa html
  for (const filter of [...filters.user, ...filters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (vars.tagline) extraArgs.push(`--metadata=tagline:${vars.tagline}`);
  if (vars.theme) extraArgs.push(`--metadata=theme:${vars.theme}`);
  if (vars.accent) extraArgs.push(`--metadata=accent:${vars.accent}`);
  if (vars.css) extraArgs.push(`--metadata=css:${vars.css}`);
  if (vars.authorMeta) extraArgs.push(`--metadata=author-meta:${vars.authorMeta}`);
  // -V (template variable): se inserta cruda, sin escape HTML (el logo es SVG)
  if (vars.logoInline) extraArgs.push(`--variable=logo-inline:${vars.logoInline}`);

  return runPandoc({ input: JSON.stringify(ast), sourcePath: doc.filePath, from: 'json', to: 'html5', bibOptions, extraArgs });
}

/**
 * Genera el AST canónico desde el markdown de un documento (sin frontmatter),
 * aplicando los filtros semánticos (string + ast) y los de usuario.
 * Retorna null si el archivo no se puede leer o el JSON no es válido.
 */
export async function markdownToAst(
  doc: BuildDocument,
  cwd: string,
  siteConfig: SiteConfig,
  luaFilters?: LuaFilterGroup,
): Promise<Record<string, unknown> | null> {
  const filters = luaFilters ?? (await loadFilterGroups(siteConfig, siteConfig.disabledFilters, cwd));

  // Leer body del disco sin frontmatter (parser compartido con discovery)
  let body = '';
  try {
    body = splitFrontmatter(await Bun.file(doc.filePath).text()).body;
  } catch {
    return null;
  }
  if (!body.trim()) return null;

  // Convertir markdown a JSON AST con los filtros Lua semánticos + de usuario
  const semanticLuaArgs = [...filters.semantic, ...filters.user].flatMap((f) => ['--lua-filter', f]);
  const json = await runPandoc({
    input: body,
    sourcePath: doc.filePath,
    from: 'markdown-auto_identifiers',
    to: 'json',
    extraArgs: semanticLuaArgs,
  });
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    logWarning(`error al parsear AST JSON de ${doc.filePath}`, 'render');
    return null;
  }
}

/**
 * Genera el cuerpo LaTeX + flags de preámbulo desde el AST canónico.
 * Se usa en el pipeline por documento y para formatos nuevos desde el AST en disco.
 */
export async function texBodyFromAst(
  ast: Record<string, unknown>,
  doc: BuildDocument,
  cwd: string,
  siteConfig: SiteConfig,
  luaFilters?: LuaFilterGroup,
): Promise<{ body: string; flags: PreambleFlags }> {
  const filters = luaFilters ?? (await loadFilterGroups(siteConfig, siteConfig.disabledFilters, cwd));
  const { bibFiles } = await resolveBibOptions(cwd);
  const flags = computePreambleFlags(ast);
  // Detección de citas desde el AST (nodos Cite reales, sin regex sobre el markdown)
  const hasCiteKeys = bibFiles.length > 0 && hasCiteNodes(ast);
  const body = await renderTexBody(ast, doc, bibFiles, hasCiteKeys, filters.latex, filters.user);
  return { body, flags };
}
