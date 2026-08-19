import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import slugifyLib from 'slugify';
import { BuildError, formatUserError, translateSystemError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { mapWithConcurrency } from '../lib/run.js';
import { listMarkdownDocuments } from './gitignore.js';
import { looseColonLines, looseColonsMessage, MISSING_TITLE_WARNING, validateFrontmatterFields } from './project-validator.js';
import { resolveSlugs } from './slug-resolver.js';
import { type BibFileCache, type BuildState, type FilterFileCache, hashString, loadStateFile, saveStateFile } from './state.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';

interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  /** Entradas de archivos eliminados (title/author/slug para calcular slugs). */
  deletedEntries: Map<string, DiscoveryEntry>;
  /** Archivos cuyo slug cambio (relativePath -> slug anterior). */
  slugChangedEntries: Map<string, string>;
}

/**
 * Convierte un texto a slug URL-safe. Usa la librería slugify (con `strict`
 * elimina lo que no sea [a-z0-9] y con `lower` normaliza a minúsculas);
 * maneja caracteres acentuados y ß→ss. Los símbolos se mapean al español
 * antes de slugificar porque el mapa interno de slugify es en inglés
 * (&→and, %→percent) y no se puede sobrescribir: & → y, % → por-ciento.
 */
function slugify(text: string): string {
  const mapped = text.replace(/&/g, ' y ').replace(/%/g, ' por-ciento');
  return slugifyLib(mapped, { lower: true, strict: true });
}

/**
 * Calcula el slug de un documento desde su frontmatter: `title[-por-author]`.
 * Por defecto solo usa el primer autor; en caso de colisión se expande.
 * Si no hay title y se provee `fallbackPath`, usa el nombre del archivo
 * (sin extensión .md) como base.
 * Sin title ni fallbackPath, retorna undefined.
 */
export function computeSlug(
  frontmatter: { title?: string; author?: string[] },
  options?: { fallbackPath?: string; maxAuthors?: number },
): string | undefined {
  const maxAuthors = options?.maxAuthors ?? 1;
  const authors = frontmatter.author?.filter(Boolean).slice(0, maxAuthors);

  const base = frontmatter.title ? slugify(frontmatter.title) : options?.fallbackPath ? slugify(basename(options.fallbackPath, '.md')) : undefined;
  if (!base) return undefined;

  if (!authors || authors.length === 0) return base;

  const authorSlug = authors.map((a) => slugify(a)).join('-y-');
  return `${base}-por-${authorSlug}`;
}

/**
 * Fase 1 — discover: detecta cambios y actualiza el estado del build.
 * Si se proporciona prevState (desde orchestrator), evita la segunda
 * lectura de state.json.
 *
 * Detección de cambios content-addressed (por archivo):
 *   mtime y size iguales al caché  → unchanged (sin leer, sin hash)
 *   size distinto                  → changed (no hace falta hash)
 *   mtime distinto con size igual  → leer + sha256
 *     hash igual al caché          → unchanged (fue un touch) → actualizar mtime
 *     hash distinto                → changed
 */
export async function discover(
  cwd: string,
  options: {
    full?: boolean;
    activeFormats?: string[];
    prevState?: BuildState | null;
    /** Directorio de salida del build actual (se persiste para el comando info). */
    outputDir?: string;
    /** Hashes de invalidación calculados por el orchestrator, guardados en state.json. */
    meta?: {
      filtersHash: string;
      filterFileCache: FilterFileCache;
      configHashes: Record<string, string>;
      bibHash: string;
      bibFileCache: BibFileCache;
    };
  } = {},
): Promise<DiscoverResult> {
  const relativePaths: string[] = [];

  // Respetar .gitignore y directorios ignorados: descubrimiento compartido
  // con validate y doctor (única fuente de exclusión de documentos).
  relativePaths.push(...(await listMarkdownDocuments(cwd)));

  const useCache = !options.full;
  // Si orchestrator ya pasó el estado, no leer state.json otra vez
  const prevState = options.prevState !== undefined ? options.prevState : useCache ? await loadStateFile(cwd) : null;
  const discoveryIndex = useCache ? (prevState?.entries ?? new Map<string, DiscoveryEntry>()) : new Map<string, DiscoveryEntry>();

  const currentSet = new Set(relativePaths);
  const changedPaths = new Set<string>();
  const recentFiles: string[] = [];
  const deletedFiles: string[] = [];
  const slugChangedEntries = new Map<string, string>();
  // Acumulador de problemas de frontmatter con su clase: 'syntax' (YAML
  // inválido) o 'field' (validación de campos). El nombre refleja ambas
  // clases; antes se llamaba frontmatterErrors y solo describía la primera.
  const frontmatterIssues: Array<{ file: string; error: string; kind: 'syntax' | 'field' }> = [];

  const thisBuildStartedAt = Date.now();

  // Detectar cambios por archivo con caché content-addressed (mtime+size+hash)
  const FILE_IO_CONCURRENCY = Math.max(1, cpus().length - 1);
  await mapWithConcurrency(relativePaths, FILE_IO_CONCURRENCY, async (relativePath) => {
    const filePath = join(cwd, relativePath);
    let mtimeMs: number;
    let size: number;
    try {
      const stat = await Bun.file(filePath).stat();
      mtimeMs = stat.mtimeMs;
      size = stat.size;
    } catch (err) {
      // Con hint de ENOENT: al leer un documento del usuario el motivo común
      // es un nombre mal escrito o un archivo que nunca existió.
      throw new BuildError(`Error al leer "${relativePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
    }
    const mtime = Math.round(mtimeMs);
    const cached = useCache ? discoveryIndex.get(relativePath) : undefined;
    const cacheValid = cached !== undefined && cached.mtime !== undefined && cached.size !== undefined && cached.hash !== undefined;

    let needsProcessing = !cacheValid;
    let text: string | null = null;

    if (cacheValid) {
      if (mtime === cached.mtime && size === cached.size) {
        // UNCHANGED: mismo mtime y tamaño → sin leer, sin hash (~stat puro)
        needsProcessing = false;
      } else if (size !== cached.size) {
        // CHANGED: el tamaño cambió → no hace falta hash
        needsProcessing = true;
      } else {
        // AMBIGUO: mtime cambió pero el tamaño es igual → leer + sha256
        text = await Bun.file(filePath).text();
        if (hashString(text) === cached.hash) {
          // Fue un touch (o una copia con el mismo contenido): sin reprocesar
          needsProcessing = false;
          cached.mtime = mtime;
        } else {
          needsProcessing = true;
        }
      }
    }

    if (needsProcessing) {
      changedPaths.add(relativePath);
      recentFiles.push(relativePath);

      // Leer contenido (una sola vez) para hash + frontmatter
      if (text === null) {
        try {
          text = await Bun.file(filePath).text();
        } catch (err) {
          throw new BuildError(`Error al leer "${relativePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
        }
      }
      const hash = hashString(text);

      // Read YAML frontmatter
      let title = '',
        subtitle: string | undefined,
        date: string | undefined,
        authors: string[] = [],
        manualSlug: string | undefined,
        rawTitle: unknown,
        fm: Record<string, unknown> | undefined;
      const { yaml, body } = splitFrontmatter(text);
      try {
        if (yaml) {
          const yamlResult = parseYamlWithPosition(yaml);
          if (yamlResult.error) throw new Error(yamlResult.error);
          const parsed = yamlResult.value;
          if (parsed && Array.isArray(parsed)) {
            // Mismo criterio que validate: el frontmatter debe ser un objeto.
            frontmatterIssues.push({ file: relativePath, error: 'frontmatter YAML inválido: debe ser un objeto', kind: 'syntax' });
          } else if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            fm = record;
            rawTitle = record.title;
            // Checks compartidos con validate (módulo project-validator): los
            // errores de tipos y de slug manual abortan el build igual que
            // validate; los warnings (date no ISO, campos ignorados) se
            // muestran en ambos comandos sin romper.
            for (const issue of validateFrontmatterFields(record)) {
              if (issue.severity === 'error') {
                frontmatterIssues.push({ file: relativePath, error: issue.message, kind: 'field' });
              } else {
                logWarning(`${relativePath}: ${issue.message}`, 'discover');
              }
            }
            title = typeof rawTitle === 'string' ? rawTitle : '';
            subtitle = typeof record.subtitle === 'string' && record.subtitle.trim() ? record.subtitle.trim() : undefined;
            date = typeof record.date === 'string' && record.date.trim() ? record.date.trim() : undefined;
            authors = parseAuthors(record.author);
            if (typeof record.slug === 'string' && record.slug.trim()) {
              manualSlug = record.slug.trim();
            }
          }
        }
      } catch (err) {
        frontmatterIssues.push({ file: relativePath, error: formatUserError(err), kind: 'syntax' });
      }

      // Líneas de ":" sueltas en el cuerpo: warning compartido con validate
      // (módulo project-validator), emitido solo para documentos reprocesados.
      // El offset suma las líneas del frontmatter (el número apunta al archivo).
      const lineOffset = text.slice(0, text.length - body.length).split('\n').length - 1;
      const looseColons = looseColonLines(body, lineOffset);
      if (looseColons.length > 0) {
        logWarning(`${relativePath}: ${looseColonsMessage(looseColons)}`, 'discover');
      }

      if (!title && (rawTitle === undefined || rawTitle === '')) {
        // Documento sin título: warning compartido con validate (el pipeline
        // usa "Sin título" como fallback en todos los formatos).
        logWarning(`${relativePath}: ${MISSING_TITLE_WARNING.message}`, 'discover');
      }

      // Store base data (slug resolution happens later, after all files are processed)
      // Preservar el slug anterior en la entrada para que resolveSlugs detecte el
      // cambio contra el slug final: comparar por prefijos aquí falla cuando el slug
      // nuevo es prefijo del viejo (quitar author, acortar título, sufijo -dN).
      const prevSlug = discoveryIndex.get(relativePath)?.slug;
      discoveryIndex.set(relativePath, {
        title,
        subtitle,
        author: authors,
        date,
        fm,
        mtime,
        size,
        hash,
        slug: manualSlug ?? prevSlug,
        slugFixed: manualSlug !== undefined,
        manualSlug,
      });
    }
    // Archivos sin cambios: conservan su entrada en discoveryIndex
  });

  // Detectar eliminados y capturar sus datos antes de borrarlos
  const deletedEntries = new Map<string, DiscoveryEntry>();
  for (const key of discoveryIndex.keys()) {
    if (!currentSet.has(key)) {
      changedPaths.add(key);
      deletedFiles.push(key);
      const entry = discoveryIndex.get(key);
      if (entry) deletedEntries.set(key, entry); // entry now has slug!
    }
  }

  // Limpiar discoveryIndex de archivos eliminados
  for (const p of deletedFiles) {
    discoveryIndex.delete(p);
  }

  // Frontmatter inválido: error de build (no publicar degradado). El rótulo
  // distingue la clase real: "YAML inválido" solo para problemas de sintaxis;
  // los errores de validación de campos (tipos, slug) no son un problema de
  // YAML. Con ambas clases se emite un bloque por cada una.
  if (frontmatterIssues.length > 0) {
    const blocks: string[] = [];
    for (const kind of ['syntax', 'field'] as const) {
      const issues = frontmatterIssues.filter((e) => e.kind === kind);
      if (issues.length === 0) continue;
      const label = kind === 'syntax' ? 'frontmatter YAML inválido' : 'frontmatter inválido';
      const msg = issues.map((e) => `  ${e.file}: ${e.error}`).join('\n');
      blocks.push(`${label} en ${plural(issues.length, 'documento')}:\n${msg}`);
    }
    throw new BuildError(blocks.join('\n'));
  }

  // Resolver slugs via slug-resolver
  const slugResult = await resolveSlugs(discoveryIndex, (meta, opts) => {
    // computeSlug solo retorna undefined sin fallbackPath; aqui siempre se provee
    const slug = computeSlug(meta, opts);
    if (slug === undefined) throw new BuildError(`no se pudo resolver el slug de ${opts.fallbackPath}`);
    return slug;
  });
  for (const [path, oldSlug] of slugResult.slugChangedEntries) slugChangedEntries.set(path, oldSlug);
  for (const path of slugResult.changedPaths) changedPaths.add(path);
  for (const path of slugResult.newRecentFiles) {
    if (!recentFiles.includes(path)) recentFiles.push(path);
  }

  // Solo persistir state.json si hubo cambios (archivos nuevos/modificados/eliminados
  // o los hashes de invalidación cambiaron). En builds sin cambios, evitar I/O innecesario.
  const hasChanged =
    changedPaths.size > 0 ||
    !useCache ||
    options.outputDir !== prevState?.outputDir ||
    options.meta?.filtersHash !== prevState?.filtersHash ||
    JSON.stringify(options.meta?.filterFileCache) !== JSON.stringify(prevState?.filterFileCache) ||
    JSON.stringify(options.meta?.configHashes) !== JSON.stringify(prevState?.configHashes) ||
    options.meta?.bibHash !== prevState?.bibHash ||
    JSON.stringify(options.meta?.bibFileCache) !== JSON.stringify(prevState?.bibFileCache);

  if (hasChanged) {
    await saveStateFile(cwd, {
      startedAt: thisBuildStartedAt,
      activeFormats: options.activeFormats ?? [],
      outputDir: options.outputDir,
      entries: discoveryIndex,
      filtersHash: options.meta?.filtersHash,
      filterFileCache: options.meta?.filterFileCache,
      configHashes: options.meta?.configHashes,
      bibHash: options.meta?.bibHash,
      bibFileCache: options.meta?.bibFileCache,
    });
  }

  return { relativePaths, changedPaths, discoveryIndex, deletedEntries, slugChangedEntries };
}

/**
 * Construye BuildDocument[] con frontmatter desde discoveryIndex.
 * Solo title y author — el resto usa valores por defecto.
 */
export function buildDocsFromIndex(relativePaths: string[], discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): BuildDocument[] {
  return relativePaths.map((relativePath) => {
    const entry = discoveryIndex.get(relativePath);
    return {
      filePath: join(cwd, relativePath),
      relativePath,
      frontmatter: {
        title: entry?.title || 'Sin t\u00edtulo',
        subtitle: entry?.subtitle,
        date: entry?.date ?? '',
        author: entry?.author ?? [],
      },
    };
  });
}

/**
 * Parsea el campo author del frontmatter. Acepta tanto string simple
 * como array de strings; filtra valores que no sean texto y retorna un
 * array vacío si el campo está ausente, es nulo o está vacío.
 */
export function parseAuthors(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((a: unknown): a is string => typeof a === 'string');
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [raw.trim()];
  }
  return [];
}

/**
 * Slug especial para la salida HTML: un archivo llamado `index.md` (en
 * cualquier directorio) se convierte a `index.html`. El resto de formatos
 * (PDF, EPUB, LaTeX, Markdown) usa el slug normal calculado desde el
 * frontmatter (title-por-author).
 */
export function htmlSlugFor(relativePath: string, slug: string | undefined): string {
  return basename(relativePath) === 'index.md' ? 'index' : (slug ?? basename(relativePath, '.md'));
}
