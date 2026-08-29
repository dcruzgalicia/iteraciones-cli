import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { MD_READER } from '../lib/pandoc-runner.js';
import { hashString } from './state-serialize.js';

// ── Núcleo content-addressed único (issue #2020) ───────────────────────────

/** Entrada de caché por archivo: mtime+size evitan releer el contenido. */
export interface FileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

/**
 * Decisión única de caché: ¿el par (mtime, size) coincide con la entrada
 * previa? Si hay hit, devuelve el hash reutilizable; si no, null (hay que
 * releer). Único lugar donde vive esta comparación — antes estaba copiada a
 * mano en seis módulos con comentarios «mismo patrón que…».
 */
export function cacheHitFor(prev: FileCacheEntry | undefined, mtime: number, size: number): string | null {
  if (prev && prev.mtime === mtime && prev.size === size) return prev.hash;
  return null;
}

/**
 * Hash de un archivo con caché mtime+size+hash-previo (patrón completo para
 * caches planas clave→entrada).
 *
 * Política única de ENOENT (decisión del issue #2020): archivo desaparecido ⇒
 * null (trabajo necesario; el caller decide cómo señalizarlo). Cualquier otro
 * error se propaga — tragar errores no-ENOENT ocultaba problemas reales.
 */
export async function hashFileCached(
  abs: string,
  key: string,
  prevCache: Record<string, FileCacheEntry> | undefined,
  cacheOut: Record<string, FileCacheEntry>,
): Promise<string | null> {
  const file = Bun.file(abs);
  let mtime: number;
  let size: number;
  try {
    const st = await file.stat();
    mtime = Math.round(st.mtimeMs);
    size = st.size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
  const prev = prevCache?.[key];
  const hit = cacheHitFor(prev, mtime, size);
  if (prev !== undefined && hit !== null) {
    cacheOut[key] = prev;
    return hit;
  }
  const content = await file.text();
  const entry: FileCacheEntry = { mtime, size, hash: hashString(content) };
  cacheOut[key] = entry;
  return entry.hash;
}

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
 *
 * CONTRATO DE ALTA (#2189): entra aquí todo módulo cuya lógica afecta a los
 * BYTES de una salida cacheada — composición de templates (HTML/LaTeX),
 * args de pandoc (metadatos, citas), ensamblado del ExportDocument o rutas
 * del export Markdown. Si un módulo que afecta la salida no está en la lista,
 * cambiarlo NO invalida la caché y las salidas quedan stale en silencio.
 * No hace falta para módulos cuya salida no se cachea ni para lógica que ya
 * se refleja en otros hashes (p. ej. disabled lists).
 */
export const SCHEMA_SOURCE_FILES = [
  '../lib/date.ts', // humanDate: conversión yyyy-mm-dd → fecha legible
  './pipeline.ts', // orquestación de pools de formatos
  './pipeline-formats.ts', // procesamiento por documento: emisión de formatos y cola PDF
  './render.ts', // htmlPage: post-procesamiento de referencias
  './html-composer.ts', // htmlPage + linkCitations: template HTML y enlazado de citas
  './latex-preamble.ts', // latexTemplate: composición del template LaTeX efectivo
  './latex-composer.ts', // composición del .tex completo: markdown → latex
  './pandoc-metadata.ts', // metadatos pandoc: escape, language, title/creator/date, citas
  './xmpdata.ts', // inyección de metadatos XMP/Info en el .tex
  './export/runner.ts', // markdownExport: metadatos y rutas del export Markdown
  './export/assemble.ts', // markdownExport: ensamblado de ExportDocument
] as const;

/**
 * Hash del contenido de los archivos fuente que gobiernan un área de
 * generación (versión de esquema automática). Un archivo ilegible se hashea
 * como vacío (sin romper el build: el hash cambia si el archivo reaparece).
 */
export async function computeSchemaSourceHash(
  files: readonly string[],
  baseDir: string,
  prevCache?: Record<string, FileCacheEntry>,
  cacheOut?: Record<string, FileCacheEntry>,
): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    // mtime+size (#2189): sin re-lectura cuando el archivo no cambió.
    // Cualquier error de lectura ⇒ hash vacío (comportamiento previo).
    const hash = await hashFileCached(join(baseDir, file), file, prevCache, cacheOut ?? {}).catch(() => null);
    parts.push(file, hash ?? '');
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
  /** Lista efectiva (post resolución de dependencias); si no viene, se lee la cruda de la config. */
  effectiveDisabledPreamble?: string[],
  /** Versión de pandoc (getPandocVersion): actualizar el binario invalida las conversiones (#2024). */
  pandocVersion?: string,
  /** Caché previa de los archivos fuente de esquema (#2189). */
  schemaPrevCache?: Record<string, FileCacheEntry>,
): Promise<{ hash: string; cache: FilterFileCache; schemaCache: Record<string, FileCacheEntry> }> {
  const parts: string[] = [];
  const cache: FilterFileCache = {};
  const schemaCache: Record<string, FileCacheEntry> = {};
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
        const hash = await hashFileCached(join(dir, file), file, prevCache, cache);
        // Recurso del paquete o del proyecto listado por el glob pero
        // desaparecido entre scan y stat: error, no señal de invalidación.
        if (hash === null) throw new Error(`archivo de filters/preamble desaparecido: ${join(dir, file)}`);
        parts.push(file, hash);
      }
    } catch (err) {
      // Directorio inexistente (filters/preamble del proyecto son opcionales);
      // cualquier otro error (p. ej. archivo desaparecido arriba) se propaga.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
  // Filtros Lua de usuario (`lua-filters:`) — pueden estar en cualquier directorio.
  // Ausente ⇒ null ⇒ parte vacía (misma tolerancia previa al catch).
  for (const rel of siteConfig.luaFilters ?? []) {
    const content = (await hashFileCached(join(cwd, rel), rel, prevCache, cache)) ?? '';
    parts.push(rel, content);
  }
  parts.push(JSON.stringify(siteConfig.disabledFilters ?? []));
  parts.push(JSON.stringify(effectiveDisabledPreamble ?? siteConfig.format?.pdf?.disabledPreambleFilters ?? []));
  // El reader (formato de entrada) de todas las conversiones: si cambia, las
  // salidas cacheadas quedan obsoletas y todos los documentos deben
  // re-renderizarse.
  parts.push(MD_READER);
  // Versión de pandoc: una actualización del binario puede cambiar cualquier
  // conversión; sin este input, los PDFs/HTML viejos se servirían sin aviso.
  if (pandocVersion) parts.push('pandoc', pandocVersion);
  // Versiones de esquema de los outputs cacheados: derivadas del contenido de
  // los archivos fuente que gobiernan cada área (nunca stale, sin protocolo
  // manual).
  parts.push('schema', await computeSchemaSourceHash(SCHEMA_SOURCE_FILES, import.meta.dir, schemaPrevCache, schemaCache));
  return { hash: hashString(parts.join('\0')), cache, schemaCache };
}

/**
 * Hash de configuración por formato. Cada hash agrupa solo los inputs que
 * afectan a ese formato: cambiar format.pdf no invalida los outputs HTML.
 * - pdf: format.pdf + format.latex
 * - html: format.html + template.html + bloque site + logo
 * - epub: format.epub
 * - markdown: format.markdown + lang
 */
/**
 * Caché mtime+size de los recursos empaquetados y del logo (#2091): evita
 * releer completos los recursos en builds sin cambios, mismo patrón que
 * filters/bib. ENOENT (logo ausente) ⇒ '' sin entrada.
 */
async function resourceHash(
  abs: string,
  key: string,
  prevCache: Record<string, FileCacheEntry> | undefined,
  cacheOut: Record<string, FileCacheEntry>,
): Promise<string> {
  return (await hashFileCached(abs, key, prevCache, cacheOut)) ?? '';
}

export async function computeConfigHashes(
  cwd: string,
  siteConfig: SiteConfig,
  prevFileCache?: Record<string, FileCacheEntry>,
  fileCacheOut: Record<string, FileCacheEntry> = {},
): Promise<{ hashes: Record<string, string>; cache: Record<string, FileCacheEntry> }> {
  const fmt = siteConfig.format;
  const htmlConfig = fmt?.html;
  // Recursos empaquetados vía caché mtime+size (#2091): solo re-lee contenido
  // cuando cambian; si no, reutiliza el hash previo.
  const htmlResources = (
    await Promise.all(HTML_RESOURCE_FILES.map((f) => resourceHash(join(HTML_RESOURCES_DIR, f), `html-res:${f}`, prevFileCache, fileCacheOut)))
  ).join('\n');
  const logoPath = htmlConfig?.site?.logo?.trim();
  const logo = logoPath ? await resourceHash(join(cwd, logoPath), 'html-res:logo', prevFileCache, fileCacheOut) : '';
  const hashes = {
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
  return { hashes, cache: fileCacheOut };
}
