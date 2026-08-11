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
  'card-trayectura.html',
  'card-indice.html',
  'card-formatos.html',
  'card-referencias.html',
];

/** Entrada de caché de archivo de filtro (mtime+size evitan re-leer contenido). */
interface FilterFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type FilterFileCache = Record<string, FilterFileCacheEntry>;

/**
 * Versiones de esquema de los outputs generados. Subir la versión de un área
 * cuando cambie su lógica de generación (invalida los outputs en el próximo
 * build). La lista completa de cuándo subir cada versión está en
 * CONTRIBUTING.md (sección "Cómo invalidar la caché de outputs").
 */
const CACHE_SCHEMA_VERSIONS = {
  /** Conversión yyyy-mm-dd → fecha legible (src/lib/date.ts). */
  humanDate: 'human-date-v1',
  /** Generación de la página HTML (pipeline.ts) y su post-procesamiento de referencias (render.ts). */
  htmlPage: 'html-page-v1',
  /** Composición del template LaTeX efectivo (latex-preamble.ts). */
  latexTemplate: 'latex-template-v1',
  /** Enlazado de citas del HTML (--metadata=link-citations). */
  linkCitations: 'link-citations-v1',
} as const;

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
  // Versiones de esquema de los outputs cacheados (ver CACHE_SCHEMA_VERSIONS).
  for (const version of Object.values(CACHE_SCHEMA_VERSIONS)) {
    parts.push(version);
  }
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
      `${JSON.stringify(fmt?.pdf ?? {})}\n${String(fmt?.latex?.generate ?? false)}\n${String(siteConfig.toc ?? false)}\n${String(siteConfig.lang ?? '')}`,
    ),
    // El HTML muestra la tarjeta Formatos con los formatos activos: cambiar
    // pdf/latex/epub/markdown debe regenerar las páginas HTML.
    html: hashString(
      `${JSON.stringify(fmt?.html ?? {})}\n${htmlResources}\n${logo}\n${String(siteConfig.toc ?? false)}\n` +
        `${String(fmt?.pdf?.generate ?? false)}\n${String(fmt?.latex?.generate ?? false)}\n${String(fmt?.epub?.generate ?? false)}\n${String(fmt?.markdown?.generate ?? false)}\n` +
        // lang se emite como --metadata=lang en el HTML: participar en el hash
        `${String(siteConfig.lang ?? '')}`,
    ),
    epub: hashString(`${JSON.stringify(fmt?.epub ?? {})}\n${String(siteConfig.toc ?? false)}\n${String(siteConfig.lang ?? '')}`),
    markdown: hashString(`${JSON.stringify(fmt?.markdown ?? {})}\n${String(siteConfig.lang ?? '')}`),
  };
}
