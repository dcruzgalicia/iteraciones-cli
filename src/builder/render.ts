import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { convertFragment } from '../lib/pandoc-runner.js';
import { mapWithConcurrency } from '../lib/run.js';
import { discoverBibFiles } from './latex-preamble.js';
import { loadModules } from './load-modules.js';
import type { BuildDocument } from './types.js';

// ---------------------------------------------------------------------------
// Sistema unificado de transpilers
// ---------------------------------------------------------------------------
// Cada transpiler vive en transpilers/<prioridad>-<nombre>.ts
// y exporta:
//   type: 'string'  → process(body: string): string  (regex, antes de pandoc)
//   type: 'ast'     → transform(ast): Promise<ast>    (AST, después de pandoc --to json)
//
// Pipeline:
//   markdown → transpilers string → pandoc --to json → transpilers AST → pandoc --from json --to latex

/** Ruta absoluta al directorio de transpilers del paquete. */
const PKG_TRANSPILERS_DIR = join(import.meta.dir, 'transpilers');

/** Lista de transpilers empaquetados en orden de aplicación. */
const BUILTIN_TRANSPILERS = ['01-double-colon', '02-dictum', '03-verse', '04-mbox-sentence-ends'];

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

/**
 * Carga transpilers desde el paquete y desde <cwd>/transpilers/.
 * Los transpilers del proyecto con el mismo nombre reemplazan a los del paquete.
 * @param disabledList Lista de transpilers a desactivar (blacklist). undefined = todos activos.
 */
async function loadTranspilers(
  disabledList?: string[],
  cwd?: string,
): Promise<{
  stringTranspilers: Array<{ name: string; process: (body: string) => string }>;
  astTranspilers: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }>;
}> {
  const excluded = new Set(disabledList ?? []);
  const names = BUILTIN_TRANSPILERS.filter((n) => !excluded.has(n));

  const modules = await loadModules<TranspilerModule>(PKG_TRANSPILERS_DIR, names, cwd, 'transpilers');

  const stringTranspilers: Array<{ name: string; process: (body: string) => string }> = [];
  const astTranspilers: Array<{ name: string; transform: (ast: Record<string, unknown>) => Promise<Record<string, unknown>> }> = [];

  for (const name of names) {
    const mod = modules.get(name);
    if (!mod) continue;

    if (mod.type === 'string') {
      stringTranspilers.push({ name, process: mod.process });
    } else if (mod.type === 'ast') {
      astTranspilers.push({ name, transform: mod.transform });
    }
  }

  return { stringTranspilers, astTranspilers };
}

/** Retorna informacion de todos los transpilers built-in para el CLI. */
export function getBuiltinTranspilerInfos(): TranspilerInfo[] {
  const descriptions: Record<string, string> = {
    '01-double-colon': ':: → \\vspace{\\baselineskip}',
    '02-dictum': 'Div.dictum → \\dictum[author]{quote}',
    '03-verse': 'Div.verse → \\begin{verse}...\\end{verse}',
    '04-mbox-sentence-ends': 'Envuelve primeras y ultimas 2 palabras de cada oracion en \\mbox{} (AST)',
  };
  const types: Record<string, 'string' | 'ast'> = {
    '01-double-colon': 'string',
    '02-dictum': 'ast',
    '03-verse': 'ast',
    '04-mbox-sentence-ends': 'ast',
  };
  return BUILTIN_TRANSPILERS.map((name) => ({
    name,
    type: types[name] ?? 'string',
    description: descriptions[name] ?? '',
  }));
}

/** Resultado individual del pipeline combinado. */
export interface RenderLatexResult {
  processedBody: string;
  htmlFragment: string;
  slug: string;
  relativePath: string;
}

/**
 * FASE 2+3 combinada: markdown → latex body + html fragment.
 *
 * Pipeline por archivo:
 *   markdown → transpilers string → pandoc --to json → transpilers AST
 *     → pandoc --from json --to latex → tex/{slug}.tex
 *     → pandoc --to html5 --citeproc → html/{slug}.html
 *
 * Escribe tex/{slug}.tex y html/{slug}.html directamente.
 * Retorna un mapa relativePath → { processedBody, htmlFragment, slug }.
 */
export async function renderLatex(
  docs: BuildDocument[],
  concurrency: number,
  cwd: string,
  activeTranspilers?: string[],
): Promise<Map<string, RenderLatexResult>> {
  const { stringTranspilers, astTranspilers } = await loadTranspilers(activeTranspilers, cwd);

  // Auto-descubrir archivos .bib una sola vez para todo el build
  const bibFiles = cwd ? discoverBibFiles(cwd) : [];
  const bibOptions =
    bibFiles.length > 0 ? { bibliography: bibFiles[0]!, csl: join(import.meta.dir, '../../src/lib/resources/apa-7.csl') } : undefined;

  const results = new Map<string, RenderLatexResult>();

  await mapWithConcurrency(docs, concurrency, async (doc) => {
    // Leer body del disco
    let body = '';
    if (cwd) {
      try {
        body = await Bun.file(doc.filePath).text();
        const fmMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
        if (fmMatch) {
          body = body.slice(fmMatch[0].length);
        }
      } catch {
        return;
      }
    }

    // Paso 1: transpilers string (regex) sobre el markdown original
    for (const t of stringTranspilers) {
      body = t.process(body);
    }

    if (!body.trim()) return;

    // Paso 2: convertir markdown a JSON AST
    const json = await convertFragment(body, doc.filePath, undefined, 'json', 'markdown-auto_identifiers');
    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(json) as Record<string, unknown>;
    } catch {
      process.stderr.write(`[render] error al parsear AST JSON de ${doc.filePath}\n`);
      return;
    }

    // Paso 3: transpilers AST sobre el JSON
    for (const t of astTranspilers) {
      ast = await t.transform(ast);
    }

    // Paso 4: convertir el AST modificado a LaTeX
    const pandocArgs: string[] = ['--top-level-division', 'section'];
    if (bibFiles.length > 0) {
      pandocArgs.push('--biblatex');
      for (const bib of bibFiles) {
        pandocArgs.push('--bibliography', bib);
      }
    }

    let processedBody = await convertFragment(JSON.stringify(ast), doc.filePath, undefined, 'latex', 'json', pandocArgs);

    // Si hay citekeys y archivos .bib, agregar printbibliography
    if (bibFiles.length > 0 && /@\w+[\w:;#.,(){}'"\s]/.test(body)) {
      processedBody = processedBody.replace(/\n+$/, '\n\n') + '\\printbibliography[heading=bibintoc]\n';
    }

    // Obtener slug del doc o calcularlo
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const dir = dirname(doc.relativePath);
    const cacheBase = join(cwd, '.iteraciones');

    // Escribir tex/{slug}.tex
    const texDir = join(cacheBase, 'tex', dir);
    await mkdir(texDir, { recursive: true });
    await Bun.write(join(texDir, `${slug}.tex`), processedBody);

    // Paso 5: convertir latex body a html fragment (con citeproc)
    let htmlFragment = '';
    if (bibOptions) {
      try {
        htmlFragment = await convertFragment(processedBody, doc.filePath, bibOptions, 'html5', 'latex-auto_identifiers');
      } catch {
        process.stderr.write(`[render] error al convertir a HTML para ${doc.relativePath}
`);
      }
    } else {
      try {
        htmlFragment = await convertFragment(processedBody, doc.filePath, undefined, 'html5', 'latex-auto_identifiers');
      } catch {
        process.stderr.write(`[render] error al convertir a HTML para ${doc.relativePath}
`);
      }
    }

    // Escribir html/{slug}.html
    if (htmlFragment) {
      const htmlDir = join(cacheBase, 'html', dir);
      await mkdir(htmlDir, { recursive: true });
      await Bun.write(join(htmlDir, `${slug}.html`), htmlFragment);
    }

    results.set(doc.relativePath, { processedBody, htmlFragment, slug, relativePath: doc.relativePath });
  });

  return results;
}
