import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { logWarning } from '../lib/logger.js';
import { type BibOptions, convertFragment } from '../lib/pandoc-runner.js';
import { mapWithConcurrency } from '../lib/run.js';
import { discoverBibFiles } from './latex-preamble.js';
import { loadModules } from './load-modules.js';
import type { BuildDocument } from './types.js';

// ---------------------------------------------------------------------------
// Sistema de transpilers por capas (decisión D1)
// ---------------------------------------------------------------------------
// semantic/string y semantic/ast: corren UNA vez sobre el documento y dejan
//   el AST canónico sin contenido de formato específico (Div.spacer, y los
//   Div.dictum/verse/center/flushright sin transformar).
// latex/ y html/: transpilers de FORMATO que corren en cada exportación y
//   convierten los nodos semánticos a su formato.
//
// Pipeline:
//   markdown → [semantic string] → pandoc --to json → [semantic ast]
//     → AST canónico
//       → [latex] → pandoc --from json --to latex → tex
//       → [html]  → pandoc --from json --to html5 → html fragment

/** Rutas absolutas a los directorios de transpilers del paquete. */
const TRANSPILERS_ROOT = join(import.meta.dir, 'transpilers');
const SEMANTIC_STRING_DIR = join(TRANSPILERS_ROOT, 'semantic', 'string');
const SEMANTIC_AST_DIR = join(TRANSPILERS_ROOT, 'semantic', 'ast');
const LATEX_DIR = join(TRANSPILERS_ROOT, 'latex');
const HTML_DIR = join(TRANSPILERS_ROOT, 'html');

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

interface StringTranspiler {
  type: 'string';
  process(body: string): string;
}

interface AstTranspiler {
  type: 'ast';
  transform(ast: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface TranspilerInfo {
  name: string;
  type: 'string' | 'ast';
  description: string;
}

type TranspilerModule = StringTranspiler | AstTranspiler;

/** Nombres completos (grupo/nombre) de todos los transpilers built-in. */
export function getBuiltinTranspilerNames(): string[] {
  return [
    ...BUILTIN_SEMANTIC_STRING.map((n) => `semantic/string/${n}`),
    ...BUILTIN_SEMANTIC_AST.map((n) => `semantic/ast/${n}`),
    ...BUILTIN_LATEX_TRANSPILERS.map((n) => `latex/${n}`),
    ...BUILTIN_HTML_TRANSPILERS.map((n) => `html/${n}`),
  ];
}

/**
 * Carga los transpilers por grupo desde el paquete y desde <cwd>/transpilers/.
 * Los transpilers del proyecto con el mismo nombre reemplazan a los del paquete.
 * @param disabledList Lista de transpilers a desactivar (nombres completos). undefined = todos activos.
 * @param cwd Directorio del proyecto para buscar overrides.
 */
async function loadTranspilerGroups(
  disabledList?: string[],
  cwd?: string,
): Promise<{
  semanticString: Array<{ name: string; process: (body: string) => string }>;
  semanticAst: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }>;
  latex: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }>;
  html: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }>;
}> {
  const excluded = new Set(disabledList ?? []);

  const loadGroup = async (dir: string, names: string[], groupPrefix: string): Promise<Map<string, TranspilerModule>> => {
    const active = names.filter((n) => !excluded.has(`${groupPrefix}/${n}`));
    return loadModules<TranspilerModule>(dir, active, cwd, `transpilers/${groupPrefix}`);
  };

  const [semanticStringMods, semanticAstMods, latexMods, htmlMods] = await Promise.all([
    loadGroup(SEMANTIC_STRING_DIR, BUILTIN_SEMANTIC_STRING, 'semantic/string'),
    loadGroup(SEMANTIC_AST_DIR, BUILTIN_SEMANTIC_AST, 'semantic/ast'),
    loadGroup(LATEX_DIR, BUILTIN_LATEX_TRANSPILERS, 'latex'),
    loadGroup(HTML_DIR, BUILTIN_HTML_TRANSPILERS, 'html'),
  ]);

  const semanticString: Array<{ name: string; process: (body: string) => string }> = [];
  const semanticAst: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }> = [];
  const latex: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }> = [];
  const html: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }> = [];

  for (const name of BUILTIN_SEMANTIC_STRING) {
    const mod = semanticStringMods.get(name);
    if (mod?.type === 'string') semanticString.push({ name, process: mod.process });
  }
  for (const name of BUILTIN_SEMANTIC_AST) {
    const mod = semanticAstMods.get(name);
    if (mod?.type === 'ast') semanticAst.push({ name, transform: mod.transform });
  }
  for (const name of BUILTIN_LATEX_TRANSPILERS) {
    const mod = latexMods.get(name);
    if (mod?.type === 'ast') latex.push({ name, transform: mod.transform });
  }
  for (const name of BUILTIN_HTML_TRANSPILERS) {
    const mod = htmlMods.get(name);
    if (mod?.type === 'ast') html.push({ name, transform: mod.transform });
  }

  return { semanticString, semanticAst, latex, html };
}

/** Retorna informacion de todos los transpilers built-in para el CLI. */
export function getBuiltinTranspilerInfos(): TranspilerInfo[] {
  const descriptions: Record<string, string> = {
    'semantic/string/01-double-colon': ':: → Div.spacer (semántico)',
    'semantic/ast/02-double-colon-noindent': ':; → Div.spacer noindent (semántico)',
    'latex/01-spacer': 'Div.spacer → \\vspace{\\baselineskip} (+\\noindent si noindent)',
    'latex/02-dictum': 'Div.dictum → \\dictum[author]{quote}',
    'latex/03-verse': 'Div.verse → \\begin{verse}...\\end{verse}',
    'latex/04-center': 'Div.center → \\begin{center}...\\end{center}',
    'latex/05-flushright': 'Div.flushright → \\begin{flushright}...\\end{flushright}',
    'latex/06-mbox-sentence-end': 'Envuelve las ultimas 2 (o 3 al final) palabras de cada oracion en \\mbox{}',
    'latex/07-mbox-sentence-start': 'Envuelve la primera palabra de cada oracion en \\mbox{}',
    'html/01-dictum': 'Div.dictum → <blockquote class="dictum">',
    'html/02-verse': 'Div.verse → <div class="verse">',
    'html/03-center': 'Div.center → <div class="center">',
    'html/04-flushright': 'Div.flushright → <div class="flushright">',
    'html/05-spacer': 'Div.spacer → <div class="spacer"></div>',
  };
  const types: Record<string, 'string' | 'ast'> = {
    'semantic/string/01-double-colon': 'string',
  };
  return getBuiltinTranspilerNames().map((name) => ({
    name,
    type: types[name] ?? 'ast',
    description: descriptions[name] ?? '',
  }));
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
  return JSON.stringify(ast).includes('"t":"Cite"');
}

type TranspilerGroups = Awaited<ReturnType<typeof loadTranspilerGroups>>;

/** Convierte el AST canónico a body LaTeX con los transpilers de formato latex. */
async function renderLatexBody(
  ast: Record<string, unknown>,
  doc: BuildDocument,
  groups: TranspilerGroups,
  bibFiles: string[],
  hasCiteKeys: boolean,
): Promise<string> {
  let latexAst: Record<string, unknown> = structuredClone(ast);
  for (const t of groups.latex) {
    latexAst = await t.transform(latexAst);
  }
  const pandocArgs: string[] = ['--top-level-division', 'section', '--shift-heading-level-by=2'];
  if (bibFiles.length > 0) {
    pandocArgs.push('--biblatex');
    for (const bib of bibFiles) {
      pandocArgs.push('--bibliography', bib);
    }
  }
  let processedBody = await convertFragment(JSON.stringify(latexAst), doc.filePath, undefined, 'latex', 'json', pandocArgs);
  if (bibFiles.length > 0 && hasCiteKeys) {
    processedBody = `${processedBody.replace(/\n+$/, '\n\n')}\\printbibliography[heading=bibintoc]\n`;
  }
  return processedBody;
}

/** Convierte el AST canónico a fragmento HTML con los transpilers de formato html. */
async function renderHtmlFragment(
  ast: Record<string, unknown>,
  doc: BuildDocument,
  groups: TranspilerGroups,
  bibOptions?: BibOptions,
): Promise<string> {
  let htmlAst: Record<string, unknown> = structuredClone(ast);
  for (const t of groups.html) {
    htmlAst = await t.transform(htmlAst);
  }
  return convertFragment(JSON.stringify(htmlAst), doc.filePath, bibOptions, 'html5', 'json');
}

/** Escribe el AST canónico y los outputs cacheados según los formatos activos. */
async function writeCachedArtifacts(
  cwd: string,
  doc: BuildDocument,
  slug: string,
  ast: Record<string, unknown>,
  processedBody?: string,
  flags?: PreambleFlags,
  htmlFragment?: string,
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
  if (htmlFragment) {
    const htmlDir = join(cacheBase, 'html', dir);
    await mkdir(htmlDir, { recursive: true });
    await Bun.write(join(htmlDir, `${slug}.html`), htmlFragment);
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
 *     → [transpilers semánticos ast] → AST canónico
 *     → [transpilers latex] → pandoc --from json --to latex → tex/{slug}.tex (si generateLatex)
 *     → [transpilers html]  → pandoc --from json --to html5 → html/{slug}.html (si generateHtml)
 *
 * El AST canónico siempre se serializa a disco (`.iteraciones/ast/{slug}.json`)
 * en formato JSON nativo de pandoc: es el origen único de los demás formatos
 * (EPUB y Markdown se exportan desde él en src/builder/export/runner.ts).
 *
 * Retorna los relativePath procesados.
 */
export async function renderLatex(
  docs: BuildDocument[],
  concurrency: number,
  cwd: string,
  activeTranspilers?: string[],
  generateHtml?: boolean,
  generateLatex?: boolean,
): Promise<Set<string>> {
  const groups = await loadTranspilerGroups(activeTranspilers, cwd);
  const { bibFiles, bibOptions } = bibContext(cwd);

  const processed = new Set<string>();

  await mapWithConcurrency(docs, concurrency, async (doc) => {
    // Leer body del disco
    let body = '';
    try {
      body = await Bun.file(doc.filePath).text();
      const fmMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
      if (fmMatch) {
        body = body.slice(fmMatch[0].length);
      }
    } catch {
      return;
    }

    // Paso 1: transpilers semánticos string (regex) sobre el markdown original
    for (const t of groups.semanticString) {
      body = t.process(body);
    }

    if (!body.trim()) return;

    // Paso 2: convertir markdown a JSON AST
    const json = await convertFragment(body, doc.filePath, undefined, 'json', 'markdown-auto_identifiers');
    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(json) as Record<string, unknown>;
    } catch {
      logWarning(`error al parsear AST JSON de ${doc.filePath}`, 'render');
      return;
    }

    // Paso 3: transpilers semánticos ast → AST canónico
    for (const t of groups.semanticAst) {
      ast = await t.transform(ast);
    }

    // Flags de preámbulo desde la estructura real del AST canónico
    const flags = computePreambleFlags(ast);
    let processedBody: string | undefined;
    if (generateLatex !== false) {
      const hasCiteKeys = bibFiles.length > 0 && /@\w+[\w:;#.,(){}'"\s]/.test(body);
      processedBody = await renderLatexBody(ast, doc, groups, bibFiles, hasCiteKeys);
    }

    // Paso 4: transpilers de formato HTML → html fragment (con citeproc)
    let htmlFragment = '';
    if (generateHtml !== false) {
      try {
        htmlFragment = await renderHtmlFragment(ast, doc, groups, bibOptions);
      } catch {
        logWarning(`error al convertir a HTML para ${doc.relativePath}`, 'render');
      }
    }

    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    await writeCachedArtifacts(cwd, doc, slug, ast, processedBody, flags, htmlFragment);
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
  generateHtml?: boolean,
  generateLatex?: boolean,
  activeTranspilers?: string[],
): Promise<Set<string>> {
  const groups = await loadTranspilerGroups(activeTranspilers, cwd);
  const { bibFiles, bibOptions } = bibContext(cwd);
  const processed = new Set<string>();

  await mapWithConcurrency(docs, concurrency, async (doc) => {
    const ast = await readAstFromCache(cwd, doc);
    if (!ast) return;

    const flags = computePreambleFlags(ast);
    let processedBody: string | undefined;
    if (generateLatex !== false) {
      // El markdown original no está disponible: detectar citas desde el AST
      const hasCiteKeys = bibFiles.length > 0 && hasCiteNodes(ast);
      processedBody = await renderLatexBody(ast, doc, groups, bibFiles, hasCiteKeys);
    }

    let htmlFragment = '';
    if (generateHtml !== false) {
      try {
        htmlFragment = await renderHtmlFragment(ast, doc, groups, bibOptions);
      } catch {
        logWarning(`error al convertir a HTML para ${doc.relativePath}`, 'render');
      }
    }

    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    await writeCachedArtifacts(cwd, doc, slug, ast, processedBody, flags, htmlFragment);
    processed.add(doc.relativePath);
  });

  return processed;
}
