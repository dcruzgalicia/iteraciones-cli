import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { logWarning } from '../lib/logger.js';
import { type BibOptions, convertFragment } from '../lib/pandoc-runner.js';
import { mapWithConcurrency } from '../lib/run.js';
import { splitFrontmatter } from './discover.js';
import { discoverBibFiles } from './latex-preamble.js';
import type { BuildDocument } from './types.js';

// ---------------------------------------------------------------------------
// Sistema de transpilers por capas (decisión D1 + Fase 6: filtros Lua)
// ---------------------------------------------------------------------------
// Los transpilers son filtros Lua que corren dentro de las invocaciones pandoc:
//   semantic/string y semantic/ast: en markdown → json (dejan el AST canónico
//   sin contenido de formato específico).
//   latex/ y html/: en cada exportación (json → latex, json → html5).
//
// Pipeline:
//   markdown → pandoc --to json [--lua-filter semantic/*] → AST canónico
//     → pandoc --from json --to latex [--lua-filter latex/*] → tex
//     → pandoc --from json --to html5 [--lua-filter html/*] → página HTML

/** Lista de transpilers semánticos string en orden de aplicación. */
const BUILTIN_SEMANTIC_STRING = ['01-double-colon'];

/** Lista de transpilers semánticos ast en orden de aplicación. */
const BUILTIN_SEMANTIC_AST = ['02-double-colon-noindent'];

/** Lista de transpilers de formato LaTeX en orden de aplicación. */
const BUILTIN_LATEX_TRANSPILERS = [
  '01-spacer',
  '02-dictum',
  '03-verse',
  '04-center',
  '05-flushright',
  '06-mbox-sentence-end',
  '07-mbox-sentence-start',
];

/** Lista de transpilers de formato HTML en orden de aplicación. */
const BUILTIN_HTML_TRANSPILERS = ['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer'];

/** Raíz de los filtros Lua del paquete (Fase 6: migración a filtros Lua). */
const LUA_TRANSPILERS_ROOT = join(import.meta.dir, '../lib/resources/transpilers');

/** Filtros Lua resueltos por capa (rutas absolutas, en orden de aplicación). */
export interface LuaFilterGroup {
  semantic: string[];
  latex: string[];
  html: string[];
  /** Filtros Lua de usuario (`lua-filters:` del proyecto), corren en todas las invocaciones. */
  user: string[];
  /** Nombres completos resueltos como .lua (los .ts equivalentes se omiten). */
  resolvedNames: Set<string>;
}

/** Resuelve el .lua de un transpiler: override del proyecto gana sobre el paquete. */
async function resolveLuaFilter(group: string, name: string, cwd?: string): Promise<string | undefined> {
  if (cwd) {
    const projectPath = join(cwd, 'transpilers', group, `${name}.lua`);
    if (await Bun.file(projectPath).exists()) return projectPath;
  }
  const pkgPath = join(LUA_TRANSPILERS_ROOT, group, `${name}.lua`);
  return (await Bun.file(pkgPath).exists()) ? pkgPath : undefined;
}

/**
 * Resuelve los filtros Lua por capa (sistema dual de la Fase 6): los nombres
 * con un .lua disponible (paquete o override del proyecto) se pasan como
 * `--lua-filter` en la invocación pandoc de su capa y omiten el .ts equivalente.
 */
export async function resolveLuaFilters(disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const excluded = new Set(disabledList ?? []);
  const result: LuaFilterGroup = { semantic: [], latex: [], html: [], user: [], resolvedNames: new Set() };

  const groups: Array<{ prefix: string; names: string[]; target: 'semantic' | 'latex' | 'html' }> = [
    { prefix: 'semantic/string', names: BUILTIN_SEMANTIC_STRING, target: 'semantic' },
    { prefix: 'semantic/ast', names: BUILTIN_SEMANTIC_AST, target: 'semantic' },
    { prefix: 'latex', names: BUILTIN_LATEX_TRANSPILERS, target: 'latex' },
    { prefix: 'html', names: BUILTIN_HTML_TRANSPILERS, target: 'html' },
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

/** Nombres completos (grupo/nombre) de todos los transpilers built-in. */
export function getBuiltinTranspilerNames(): string[] {
  return [
    ...BUILTIN_SEMANTIC_STRING.map((n) => `semantic/string/${n}`),
    ...BUILTIN_SEMANTIC_AST.map((n) => `semantic/ast/${n}`),
    ...BUILTIN_LATEX_TRANSPILERS.map((n) => `latex/${n}`),
    ...BUILTIN_HTML_TRANSPILERS.map((n) => `html/${n}`),
  ];
}

/** Retorna el nombre completo que termina en "/<name>", si existe. */
export function suggestTranspilerName(name: string): string | undefined {
  return getBuiltinTranspilerNames().find((n) => n.endsWith(`/${name}`));
}

/**
 * Valida los nombres de `disabled-transpilers` contra los transpilers built-in.
 * Los nombres desconocidos (p. ej. de configs anteriores al cambio de nombres
 * completos de D1) emiten un warning con la sugerencia, sin romper el build.
 */
export function validateDisabledTranspilers(disabled: string[] | undefined): void {
  if (!disabled || disabled.length === 0) return;
  for (const name of disabled) {
    if (getBuiltinTranspilerNames().includes(name)) continue;
    const suggestion = suggestTranspilerName(name);
    logWarning(
      suggestion
        ? `disabled-transpilers: "${name}" no existe; ¿quisiste decir "${suggestion}"?`
        : `disabled-transpilers: "${name}" no coincide con ningún transpiler`,
      'config',
    );
  }
}

/**
 * Resuelve los filtros Lua de usuario (`lua-filters:` en _iteraciones.yaml,
 * rutas relativas al proyecto). Las rutas inexistentes emiten un warning sin
 * romper el build.
 */
export async function resolveUserLuaFilters(cwd?: string): Promise<string[]> {
  if (!cwd) return [];
  const siteConfig = await loadSiteConfig(cwd);
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
 * Resuelve los filtros Lua por capa (sistema de transpilers Fase 6): los
 * nombres con un .lua disponible (paquete o override del proyecto) se pasan
 * como `--lua-filter` en la invocación pandoc de su capa. Incluye los filtros
 * de usuario (`lua-filters:`), que corren en todas las invocaciones.
 * @param disabledList Lista de transpilers a desactivar (nombres completos). undefined = todos activos.
 * @param cwd Directorio del proyecto para buscar overrides.
 */
export async function loadTranspilerGroups(disabledList?: string[], cwd?: string): Promise<LuaFilterGroup> {
  const group = await resolveLuaFilters(disabledList, cwd);
  group.user = await resolveUserLuaFilters(cwd);
  return group;
}

/** Información de un filtro Lua built-in para el CLI. */
export interface LuaTranspilerInfo {
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
 * Escanea los filtros Lua built-in del paquete (`lib/resources/transpilers`).
 * La descripción se toma de la primera línea de comentario `-- ...` del archivo.
 */
export async function getBuiltinLuaTranspilerInfos(): Promise<LuaTranspilerInfo[]> {
  const infos: LuaTranspilerInfo[] = [];
  // El directorio de recursos se crea al migrar los primeros transpilers (Fase B)
  if (!(await dirExists(LUA_TRANSPILERS_ROOT))) return infos;
  const glob = new Bun.Glob('**/*.lua');
  for await (const rel of glob.scan({ cwd: LUA_TRANSPILERS_ROOT, onlyFiles: true })) {
    const group = dirname(rel);
    const full = `${group}/${basename(rel, '.lua')}`;
    const content = await Bun.file(join(LUA_TRANSPILERS_ROOT, rel)).text();
    const descLine = content.split('\n').find((l) => l.trim().startsWith('-- '));
    infos.push({ name: full, description: descLine?.replace(/^--\s*/, '').trim() ?? '' });
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}

/** Flags de preámbulo calculados desde el AST (estructura real del documento). */
export interface PreambleFlags {
  /** ¿Existen nodos Header? (para evitar un TOC vacío). */
  hasTocEntries: boolean;
  /** ¿El primer bloque es un heading o un dictum/verse? (no anteponer \\noindent). */
  skipNoIndent: boolean;
  /** ¿El primer bloque es un heading? (no anteponer \\vspace*{2\\baselineskip}). */
  skipParagraphSpace: boolean;
}

function isHeader(block: unknown): boolean {
  return typeof block === 'object' && block !== null && (block as Record<string, unknown>).t === 'Header';
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
 * transpilers semánticos, sin contenido de formato). Reemplaza la detección
 * por regex/startsWith sobre el LaTeX.
 */
export function computePreambleFlags(ast: Record<string, unknown>): PreambleFlags {
  const blocks = ast.blocks as unknown[];
  const list = Array.isArray(blocks) ? blocks : [];
  const first = list[0];
  const isSectionStart = isHeader(first);
  // dictum y verse abren con \vspace*{...} en latex; center/flushright no
  const isDictumStart = isDivWithClass(first, 'dictum') || isDivWithClass(first, 'verse');
  return {
    hasTocEntries: list.some(isHeader),
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
async function renderLatexBody(
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
  let processedBody = await convertFragment(JSON.stringify(ast), doc.filePath, undefined, 'latex', 'json', pandocArgs);
  if (bibFiles.length > 0 && hasCiteKeys) {
    processedBody = `${processedBody.replace(/\n+$/, '\n\n')}\\printbibliography[heading=bibintoc]\n`;
  }
  return processedBody;
}

/** Ruta de la plantilla HTML (template system de pandoc). */
const HTML_TEMPLATE_PATH = join(import.meta.dir, '../../src/lib/resources/template.html');

/** Variables de la plantilla HTML (template system de pandoc). */
export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  lang: string;
  baseUrl?: string;
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
  bibOptions?: BibOptions,
  activeTranspilers?: string[],
): Promise<string> {
  const luaFilters = await loadTranspilerGroups(activeTranspilers, cwd);

  const extraArgs = [
    '--template',
    HTML_TEMPLATE_PATH,
    `--metadata=title:${vars.title}`,
    `--metadata=site-title:${vars.siteTitle}`,
    `--metadata=lang:${vars.lang}`,
  ];
  // Filtros de usuario primero, luego la capa html
  for (const filter of [...luaFilters.user, ...luaFilters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (vars.tagline) extraArgs.push(`--metadata=tagline:${vars.tagline}`);
  if (vars.baseUrl) extraArgs.push(`--metadata=base-url:${vars.baseUrl}`);
  if (vars.theme) extraArgs.push(`--metadata=theme:${vars.theme}`);
  if (vars.accent) extraArgs.push(`--metadata=accent:${vars.accent}`);
  if (vars.css) extraArgs.push(`--metadata=css:${vars.css}`);
  if (vars.authorMeta) extraArgs.push(`--metadata=author-meta:${vars.authorMeta}`);
  // -V (template variable): se inserta cruda, sin escape HTML (el logo es SVG)
  if (vars.logoInline) extraArgs.push(`--variable=logo-inline:${vars.logoInline}`);

  return convertFragment(JSON.stringify(ast), doc.filePath, bibOptions, 'html5', 'json', extraArgs);
}

/** Escribe el AST canónico y los outputs cacheados según los formatos activos. */
async function writeCachedArtifacts(
  cwd: string,
  doc: BuildDocument,
  slug: string,
  ast: Record<string, unknown>,
  processedBody?: string,
  flags?: PreambleFlags,
): Promise<void> {
  const dir = dirname(doc.relativePath);
  const cacheBase = join(cwd, '.iteraciones');
  const astDir = join(cacheBase, 'ast', dir);
  await mkdir(astDir, { recursive: true });
  await Bun.write(join(astDir, `${slug}.json`), JSON.stringify(ast));
  if (processedBody !== undefined && flags !== undefined) {
    const texDir = join(cacheBase, 'tex', dir);
    await mkdir(texDir, { recursive: true });
    await Bun.write(join(texDir, `${slug}.tex`), processedBody);
    await Bun.write(join(texDir, `${slug}.flags.json`), JSON.stringify(flags));
  }
}

/** Contexto compartido de bibliografía para las exportaciones. */
function bibContext(cwd: string): { bibFiles: string[]; bibOptions?: BibOptions } {
  const bibFiles = cwd ? discoverBibFiles(cwd) : [];
  const firstBib = bibFiles[0];
  const bibOptions = firstBib !== undefined ? { bibliography: firstBib, csl: join(import.meta.dir, '../../src/lib/resources/apa-7.csl') } : undefined;
  return { bibFiles, bibOptions };
}

/** Lee el AST canónico serializado de `.iteraciones/ast/{slug}.json`. */
export async function readAstFromCache(cwd: string, doc: BuildDocument): Promise<Record<string, unknown> | null> {
  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const dir = dirname(doc.relativePath);
  const astPath = join(cwd, '.iteraciones', 'ast', dir, `${slug}.json`);
  const raw = await Bun.file(astPath)
    .text()
    .catch(() => '');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    logWarning(`error al parsear AST en disco de ${doc.relativePath}`, 'render');
    return null;
  }
}

/**
 * FASE 2+3 combinada: markdown → AST canónico → salidas por formato activo.
 *
 * Pipeline por archivo:
 *   markdown → [transpilers semánticos string] → pandoc --to json
 *     → [filtros Lua semánticos] → AST canónico
 *     → [filtros Lua latex] → pandoc --from json --to latex → tex/{slug}.tex (si generateLatex)
 *
 * El AST canónico siempre se serializa a disco (`.iteraciones/ast/{slug}.json`)
 * en formato JSON nativo de pandoc: es el origen único de los demás formatos
 * (HTML se pagina con el template de pandoc, EPUB y Markdown se exportan
 * desde él en src/builder/export/runner.ts).
 *
 * Retorna los relativePath procesados.
 */
export async function renderLatex(
  docs: BuildDocument[],
  concurrency: number,
  cwd: string,
  activeTranspilers?: string[],
  generateLatex?: boolean,
): Promise<Set<string>> {
  const luaFilters = await loadTranspilerGroups(activeTranspilers, cwd);
  const { bibFiles } = bibContext(cwd);

  const processed = new Set<string>();

  await mapWithConcurrency(docs, concurrency, async (doc) => {
    // Leer body del disco sin frontmatter (parser compartido con discovery)
    let body = '';
    try {
      body = splitFrontmatter(await Bun.file(doc.filePath).text()).body;
    } catch {
      return;
    }

    if (!body.trim()) return;

    // Paso 1: convertir markdown a JSON AST con los filtros Lua semánticos + de usuario
    const semanticLuaArgs = [...luaFilters.semantic, ...luaFilters.user].flatMap((f) => ['--lua-filter', f]);
    const json = await convertFragment(body, doc.filePath, undefined, 'json', 'markdown-auto_identifiers', semanticLuaArgs);
    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(json) as Record<string, unknown>;
    } catch {
      logWarning(`error al parsear AST JSON de ${doc.filePath}`, 'render');
      return;
    }

    // Paso 2: AST canónico → flags de preámbulo + salidas por formato activo
    const flags = computePreambleFlags(ast);
    let processedBody: string | undefined;
    if (generateLatex !== false) {
      // Detección de citas desde el AST (nodos Cite reales, sin regex sobre el markdown)
      const hasCiteKeys = bibFiles.length > 0 && hasCiteNodes(ast);
      processedBody = await renderLatexBody(ast, doc, bibFiles, hasCiteKeys, luaFilters.latex, luaFilters.user);
    }

    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    await writeCachedArtifacts(cwd, doc, slug, ast, processedBody, flags);
    processed.add(doc.relativePath);
  });

  return processed;
}

/**
 * Exporta las salidas desde el AST canónico serializado en disco
 * (`.iteraciones/ast/{slug}.json`) sin re-ejecutar markdown → json.
 *
 * Se usa cuando se activa un formato nuevo: el AST ya existe del build
 * anterior, solo faltan las salidas de ese formato. Los docs sin AST en
 * disco se omiten del resultado (el caller los manda al pipeline completo).
 */
export async function renderFromAstCache(
  docs: BuildDocument[],
  concurrency: number,
  cwd: string,
  generateLatex?: boolean,
  activeTranspilers?: string[],
): Promise<Set<string>> {
  const luaFilters = await loadTranspilerGroups(activeTranspilers, cwd);
  const { bibFiles } = bibContext(cwd);
  const processed = new Set<string>();

  await mapWithConcurrency(docs, concurrency, async (doc) => {
    const ast = await readAstFromCache(cwd, doc);
    if (!ast) return;

    const flags = computePreambleFlags(ast);
    let processedBody: string | undefined;
    if (generateLatex !== false) {
      // El markdown original no está disponible: detectar citas desde el AST
      const hasCiteKeys = bibFiles.length > 0 && hasCiteNodes(ast);
      processedBody = await renderLatexBody(ast, doc, bibFiles, hasCiteKeys, luaFilters.latex, luaFilters.user);
    }

    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    await writeCachedArtifacts(cwd, doc, slug, ast, processedBody, flags);
    processed.add(doc.relativePath);
  });

  return processed;
}
