import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { MD_READER } from './html-composer.js';
import { hashFileContent, hashString } from './state-serialize.js';

/** Recursos del template HTML del paquete (participan en la invalidación del formato HTML). */
const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');
const HTML_RESOURCE_FILES = [
  'skeleton.html',
  'card-identity.html',
  'card-identity-footer.html',
  'card-contenido.html',
  'card-indice.html',
  'card-formatos.html',
  'card-referencias.html',
  'card-referencias-block.html',
];

/** Entrada de caché de archivo de filtro (mtime+size evitan re-leer contenido). */
interface FilterFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type FilterFileCache = Record<string, FilterFileCacheEntry>;

/**
 * Archivos fuente cuya lógica gobierna la generación de los outputs cacheados.
 * Su contenido participa en el hash de filters como versión de esquema: si la
 * lógica cambia entre builds, el hash cambia y las salidas se regeneran.
 * Invalidaciones conservadoras (un refactor sin efecto en la salida re-renderiza
 * una vez) son el precio aceptado: nunca stale.
 */
export const SCHEMA_SOURCE_FILES = [
  '../lib/date.ts', // humanDate: conversión yyyy-mm-dd → fecha legible
  './pipeline.ts', // htmlPage: generación de la página HTML
  './render.ts', // htmlPage: post-procesamiento de referencias
  './html-composer.ts', // htmlPage + linkCitations: template HTML y enlazado de citas
  './latex-preamble.ts', // latexTemplate: composición del template LaTeX efectivo
  './export/runner.ts', // markdownExport: metadatos y rutas del export Markdown
  './export/assemble.ts', // markdownExport: ensamblado de ExportDocument
] as const;

/**
 * Hash del contenido de los archivos fuente que gobiernan un área de
 * generación (versión de esquema automática). Un archivo ilegible se hashea
 * como vacío (sin romper el build: el hash cambia si el archivo reaparece).
 */
export async function computeSchemaSourceHash(files: readonly string[], baseDir: string): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    parts.push(file, await hashFileContent(join(baseDir, file)).catch(() => ''));
  }
  return hashString(parts.join('\0'));
}

/**
 * Hashea los filtros efectivos (paquete + proyecto) y de los preamble
 * filters, incluyendo las disabled lists. Cambia solo si el código de un
 * filter o la lista de desactivados cambia.
 *
 * Con `prevCache` (de state.json), cada archivo se compara por mtime+size:
 * si no cambió, se reutiliza su hash sin leer el contenido (mismo patrón
 * content-addressed que discover usa para los documentos).
 */
export async function computeFiltersHash(
  cwd: string,
  siteConfig: SiteConfig,
  prevCache?: FilterFileCache,
): Promise<{ hash: string; cache: FilterFileCache }> {
  const parts: string[] = [];
  const cache: FilterFileCache = {};
  // [directorio, glob]: filtros Lua del paquete y del proyecto, preamble .tex
  const specs: Array<[string, string]> = [
    [join(import.meta.dir, '../lib/resources/filters'), '**/*.lua'],
    [join(import.meta.dir, '../lib/resources/preamble'), '*.tex'],
    [join(cwd, 'filters'), '**/*.lua'],
    [join(cwd, 'preamble'), '*.tex'],
  ];
  for (const [dir, glob] of specs) {
    try {
      const files = [...new Bun.Glob(glob).scanSync({ cwd: dir })].sort();
      for (const file of files) {
        parts.push(file, await hashFilterFile(join(dir, file), prevCache, cache));
      }
    } catch {
      // Directorio inexistente (filters/preamble del proyecto son opcionales)
    }
  }
  // Filtros Lua de usuario (`lua-filters:`) — pueden estar en cualquier directorio
  for (const rel of siteConfig.luaFilters ?? []) {
    const content = await hashFilterFile(join(cwd, rel), prevCache, cache).catch(() => '');
    parts.push(rel, content);
  }
  parts.push(JSON.stringify(siteConfig.disabledFilters ?? []));
  parts.push(JSON.stringify(siteConfig.format?.pdf?.disabledPreambleFilters ?? []));
  // El reader (formato de entrada) de todas las conversiones: si cambia, las
  // salidas cacheadas quedan obsoletas y todos los documentos deben
  // re-renderizarse.
  parts.push(MD_READER);
  // Versiones de esquema de los outputs cacheados: derivadas del contenido de
  // los archivos fuente que gobiernan cada área (nunca stale, sin protocolo
  // manual).
  parts.push('schema', await computeSchemaSourceHash(SCHEMA_SOURCE_FILES, import.meta.dir));
  return { hash: hashString(parts.join('\0')), cache };
}

/** Hash del contenido de un archivo de filtro, reutilizando el caché si mtime+size coinciden. */
async function hashFilterFile(abs: string, prevCache: FilterFileCache | undefined, cache: FilterFileCache): Promise<string> {
  const stat = await Bun.file(abs).stat();
  const mtime = Math.round(stat.mtimeMs);
  const size = stat.size;
  const prev = prevCache?.[abs];
  if (prev && prev.mtime === mtime && prev.size === size) {
    cache[abs] = prev;
    return prev.hash;
  }
  const content = await Bun.file(abs).text();
  const hash = hashString(content);
  cache[abs] = { mtime, size, hash };
  return hash;
}

/**
 * Hash de configuración por formato. Cada hash agrupa solo los inputs que
 * afectan a ese formato: cambiar format.pdf no invalida los outputs HTML.
 * - pdf: format.pdf + format.latex
 * - html: format.html + template.html + bloque site + logo
 * - epub: format.epub
 * - markdown: format.markdown + lang
 */
export async function computeConfigHashes(cwd: string, siteConfig: SiteConfig): Promise<Record<string, string>> {
  const fmt = siteConfig.format;
  const htmlConfig = fmt?.html;
  const htmlResources = (
    await Promise.all(
      HTML_RESOURCE_FILES.map((f) =>
        Bun.file(join(HTML_RESOURCES_DIR, f))
          .text()
          .catch(() => ''),
      ),
    )
  ).join('\n');
  const logoPath = htmlConfig?.logo?.trim();
  const logo = logoPath ? await hashFileContent(join(cwd, logoPath)).catch(() => '') : '';
  return {
    pdf: hashString(
      `${JSON.stringify(fmt?.pdf ?? {})}\n${String(fmt?.latex?.generate ?? false)}\n${String(siteConfig.toc ?? false)}\n${String(siteConfig.language ?? '')}`,
    ),
    // El HTML muestra la tarjeta Formatos con los formatos activos: cambiar
    // pdf/latex/epub/markdown debe regenerar las páginas HTML.
    html: hashString(
      `${JSON.stringify(fmt?.html ?? {})}\n${htmlResources}\n${logo}\n${String(siteConfig.toc ?? false)}\n` +
        `${String(fmt?.pdf?.generate ?? false)}\n${String(fmt?.latex?.generate ?? false)}\n${String(fmt?.epub?.generate ?? false)}\n${String(fmt?.markdown?.generate ?? false)}\n` +
        // language se emite como --metadata=language en el HTML: participar en el hash
        `${String(siteConfig.language ?? '')}`,
    ),
    epub: hashString(`${JSON.stringify(fmt?.epub ?? {})}\n${String(siteConfig.toc ?? false)}\n${String(siteConfig.language ?? '')}`),
    markdown: hashString(`${JSON.stringify(fmt?.markdown ?? {})}\n${String(siteConfig.language ?? '')}`),
  };
}
