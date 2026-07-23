import { join, resolve } from 'node:path';

import { mapWithConcurrency } from '../../output/concurrency.js';
import type { RenderFileReport } from '../../output/progress.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import type { PandocPool } from '../../services/pandoc-pool.js';
import { type BibOptions, convertFragment } from '../../services/pandoc-runner.js';
import type { BuildDocument } from '../types.js';

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
const PKG_TRANSPILERS_DIR = join(import.meta.dir, '../../../transpilers');

/** Lista de transpilers empaquetados en orden de aplicación. */
export const BUILTIN_TRANSPILERS = ['01-double-colon', '02-dictum', '03-verse', '04-mbox-sentence-ends'];

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

  const modules = new Map<string, TranspilerModule>();

  for (const name of names) {
    const mod = (await import(join(PKG_TRANSPILERS_DIR, `${name}.ts`))) as TranspilerModule;
    modules.set(name, mod);
  }

  // Sobrescritura del proyecto: transpilers con el mismo nombre reemplazan
  if (cwd) {
    const projectDir = join(cwd, 'transpilers');
    const projectDirExists = await Bun.file(projectDir)
      .exists()
      .catch(() => false);
    if (projectDirExists) {
      for (const name of names) {
        const projectPath = join(projectDir, `${name}.ts`);
        const exists = await Bun.file(projectPath)
          .exists()
          .catch(() => false);
        if (exists) {
          const mod = (await import(projectPath)) as TranspilerModule;
          modules.set(name, mod);
        }
      }
    }
  }

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

/** Contadores acumulativos de la fase de render; se mutan en lugar de retornar un nuevo objeto. */
export interface RenderStats {
  total: number;
  cacheHits: number;
}

/**
 * Convierte el body original de cada documento a LaTeX final (processedBody)
 * aplicando transpilers (string → AST) y filtros Lua.
 *
 * Pipeline:
 *   markdown → transpilers string → pandoc --to json → transpilers AST → pandoc --from json --to latex → .tex
 *
 * El processedBody (.tex) se usa luego como fuente para HTML, PDF, EPUB y markdown.
 */
export async function renderLatex(
  docs: BuildDocument[],
  concurrency: number,
  pool?: PandocPool,
  luaFilters?: readonly string[],
  cwd?: string,
  activeTranspilers?: string[],
): Promise<BuildDocument[]> {
  const { stringTranspilers, astTranspilers } = await loadTranspilers(activeTranspilers, cwd);

  return mapWithConcurrency(docs, concurrency, async (doc) => {
    // Paso 1: transpilers string (regex) sobre el markdown original
    let body = doc.body;
    for (const t of stringTranspilers) {
      body = t.process(body);
    }

    if (!body.trim()) {
      return { ...doc, processedBody: '' };
    }

    // Paso 2: convertir markdown a JSON AST (sin auto_identifiers para evitar labels en .tex)
    const json = await convertFragment(body, doc.filePath, pool, undefined, undefined, 'json', 'markdown-auto_identifiers');
    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(json) as Record<string, unknown>;
    } catch {
      process.stderr.write(`[render] error al parsear AST JSON de ${doc.filePath}
`);
      return { ...doc, processedBody: '' };
    }

    // Paso 3: transpilers AST sobre el JSON
    for (const t of astTranspilers) {
      ast = await t.transform(ast);
    }

    // Paso 4: convertir el AST modificado a LaTeX
    // Los filtros Lua definidos por el usuario se aplican aquí
    const pandocArgs: string[] = ['--top-level-division', 'section'];

    // Auto-descubrir archivos .bib y pasar --biblatex a pandoc
    const bibFiles: string[] = [];
    if (cwd) {
      try {
        const glob = new Bun.Glob('**/*.bib');
        for (const file of glob.scanSync({ cwd, absolute: true })) {
          const rel = file.replace(cwd, '').replace(/^\/+/, '');
          if (rel.startsWith('node_modules/') || rel.startsWith('.iteraciones/') || rel.startsWith('dist/') || rel.startsWith('.git/')) continue;
          bibFiles.push(file);
        }
      } catch {}
    }
    if (bibFiles.length > 0) {
      pandocArgs.push('--biblatex');
      for (const bib of bibFiles) {
        pandocArgs.push('--bibliography', bib);
      }
    }

    let processedBody = await convertFragment(JSON.stringify(ast), doc.filePath, pool, undefined, luaFilters, 'latex', 'json', pandocArgs);

    // Si hay citekeys en el body original y existen archivos .bib, agregar printbibliography
    const hasCitekeys = bibFiles.length > 0 && /@\w+[\w:;#.,(){}'"\s]/.test(doc.body);
    if (hasCitekeys) {
      processedBody = processedBody.replace(/\n+$/, '\n\n') + '\\printbibliography[heading=bibintoc]\n';
    }

    return { ...doc, processedBody };
  });
}

export async function renderDocuments(
  docs: BuildDocument[],
  concurrency: number,
  registry?: PluginRegistry,
  pool?: PandocPool,
  cwd?: string,
  /** Ruta absoluta al .bib global del sitio (fallback si el frontmatter no define editorial.bibliography). */
  globalBibliography?: string,
  /** Ruta absoluta al .csl global del sitio (fallback si el frontmatter no define editorial.csl). */
  globalCsl?: string,
  /** Callback invocado por cada archivo procesado (para reporte de progreso). */
  onFileProcessed?: (report: RenderFileReport) => void,
): Promise<BuildDocument[]> {
  return mapWithConcurrency(docs, concurrency, async (doc) => {
    const tStart = performance.now();
    let bibOptions: BibOptions | undefined;
    if (cwd) {
      const rawEditorial =
        typeof doc.frontmatter['editorial'] === 'object' && doc.frontmatter['editorial'] !== null
          ? (doc.frontmatter['editorial'] as Record<string, unknown>)
          : {};

      const rawBib = typeof rawEditorial['bibliography'] === 'string' ? rawEditorial['bibliography'] : undefined;
      const effectiveBib = rawBib ?? globalBibliography;

      if (effectiveBib) {
        const resolvedBib = resolve(cwd, effectiveBib);
        if (resolvedBib.startsWith(cwd + '/') || resolvedBib === cwd) {
          const rawCsl = typeof rawEditorial['csl'] === 'string' ? rawEditorial['csl'] : undefined;
          const effectiveCsl = rawCsl ?? globalCsl;
          let resolvedCsl: string | undefined;
          if (effectiveCsl) {
            const cslAbs = resolve(cwd, effectiveCsl);
            if (cslAbs.startsWith(cwd + '/') || cslAbs === cwd) {
              resolvedCsl = cslAbs;
            } else {
              process.stderr.write(`[render] CSL fuera del proyecto ignorado: "${effectiveCsl}"\n`);
            }
          } else {
            resolvedCsl = join(import.meta.dir, '../../../pandoc/csl/apa-7.csl');
          }
          bibOptions = { bibliography: resolvedBib, csl: resolvedCsl };
        } else {
          process.stderr.write(`[render] bibliography fuera del proyecto ignorado: "${effectiveBib}"\n`);
        }
      }
    }

    if (registry) {
      await registry.runBeforeRender({ sourcePath: doc.filePath, variables: {} });
    }

    const source = doc.processedBody ?? doc.body;
    const fromFormat = doc.processedBody ? 'latex' : 'markdown';
    let htmlFragment = await convertFragment(source, doc.filePath, pool, bibOptions, undefined, 'html5', fromFormat);

    if (registry) {
      const afterCtx = await registry.runAfterRender({ sourcePath: doc.filePath, html: htmlFragment });
      htmlFragment = afterCtx.html;
    }

    onFileProcessed?.({ relativePath: doc.relativePath, durationMs: performance.now() - tStart, cacheHit: false, phase: 'render' });
    return { ...doc, htmlFragment };
  });
}
