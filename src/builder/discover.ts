import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import slugifyLib from 'slugify';
import { BUILD_ERROR_CODES, BuildError, formatUserError, translateSystemError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, fmTrimmedString } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { mapWithConcurrency } from '../lib/run.js';
import { listMarkdownDocuments } from './gitignore.js';
import { looseColonLines, looseColonsMessage, MISSING_TITLE_WARNING, validateFrontmatterFields } from './project-validator.js';
import { resolveSlugs } from './slug-resolver.js';
import type { FileCacheEntry } from './state-hash.js';
import { cacheHitFor } from './state-hash.js';
import {
  type BibFileCache,
  type BuildState,
  type FilterFileCache,
  hashString,
  loadStateFile,
  STATE_SCHEMA_VERSION,
  stateUsableForBuild,
} from './state-serialize.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';

/** Resultado de discovery + estado pendiente para la única escritura del cierre (#2025). */
export type DiscoverResultAndPending = DiscoverResult & { pendingState: BuildState | null };

interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  /** Entradas de archivos eliminados (title/creator/slug para calcular slugs). */
  deletedEntries: Map<string, DiscoveryEntry>;
  /** Archivos cuyo slug cambio (relativePath -> slug anterior). */
  slugChangedEntries: Map<string, string>;
}

/** Hashes de invalidación calculados por el orchestrator, guardados en state.json. */
interface DiscoverMeta {
  filtersHash: string;
  filterFileCache: FilterFileCache;
  schemaFileCache?: Record<string, FileCacheEntry>;
  configHashes: Record<string, string>;
  configFileCache?: Record<string, FileCacheEntry>;
  bibHash: string;
  bibFileCache: BibFileCache;
}

interface DiscoverOptions {
  full?: boolean;
  activeFormats?: string[];
  /** Estado previo explícito: loadPrevState(cwd) o noPrevState() — sin tri-state (#2023). */
  prevState: BuildState | null;
  /** Directorio de salida del build actual (se persiste para el comando info). */
  outputDir?: string;
  /** Hashes de invalidación calculados por el orchestrator, guardados en state.json. */
  meta?: DiscoverMeta;
}

/**
 * Decisión content-addressed para un documento: reprocesarlo o saltarlo.
 * `text` reutiliza la lectura hecha durante la resolución del caso ambiguo.
 */
type CacheDecision = { process: false; touched?: boolean } | { process: true; text: string | null };

/** Problema acumulado de frontmatter, con su clase real. */
type FrontmatterIssue = { file: string; error: string; kind: 'syntax' | 'field' };

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
 * Calcula el slug de un documento desde su frontmatter: `title[-por-creator]`.
 * Por defecto solo usa el primer creador; en caso de colisión se expande.
 * Si no hay title y se provee `fallbackPath`, usa el nombre del archivo
 * (sin extensión .md) como base.
 * Sin title ni fallbackPath, retorna undefined.
 */
export function computeSlug(
  frontmatter: { title?: string; creator?: string[] },
  options?: { fallbackPath?: string; maxCreators?: number },
): string | undefined {
  const maxCreators = options?.maxCreators ?? 1;
  const creators = frontmatter.creator?.filter(Boolean).slice(0, maxCreators);

  const base = frontmatter.title ? slugify(frontmatter.title) : options?.fallbackPath ? slugify(basename(options.fallbackPath, '.md')) : undefined;
  if (!base) return undefined;

  if (!creators || creators.length === 0) return base;

  const creatorSlug = creators.map((a) => slugify(a)).join('-y-');
  return `${base}-por-${creatorSlug}`;
}

/**
 * Diacríticos que alteran el sentido de la palabra al transliterarse en el
 * slug (ñ→n: año/ano). Heurística sin diccionario (#2090): avisa una vez por
 * título afectado para que el autor decida. Los acentos agudos inocuos
 * (á→a) no avisaban ni avisan.
 */
function slugDiacriticWarning(title: string, slug: string): string | undefined {
  if (!/[ñü]/i.test(title)) return undefined;
  // El slug ya no contiene ñ/ü (strict las elimina): si el título las tenía,
  // hubo sustitución por n/u con posible cambio de palabra.
  if (slug.includes('ñ') || slug.includes('ü')) return undefined;
  return `el slug "${slug}" altera palabras del título "${title}" (ñ→n, ü→u): revísalo o fija uno manual con "slug:" en el frontmatter`;
}

/**
 * Estado previo para `discover`: lee state.json y lo valida como caché
 * utilizable. Constructor explícito del contrato post-tri-state (#2023).
 */
export async function loadPrevState(cwd: string): Promise<BuildState | null> {
  return stateUsableForBuild(await loadStateFile(cwd));
}

/** Sin estado previo (--full o primer build): constructor explícito (#2023). */
export function noPrevState(): BuildState | null {
  return null;
}

/**
 * Decisión única de caché (#2020) para un documento, dado su stat actual:
 *   mtime y size iguales al caché  → skip (sin leer, sin hash)
 *   size distinto                  → process (sin leer todavía)
 *   mtime distinto con size igual  → leer + sha256:
 *     hash igual → touch: actualizar mtime en la entrada y skip
 *     hash distinto → process reutilizando la lectura hecha
 */
async function resolveCacheDecision(cached: DiscoveryEntry | undefined, filePath: string, mtime: number, size: number): Promise<CacheDecision> {
  if (cached === undefined || cached.mtime === undefined || cached.size === undefined || cached.hash === undefined) {
    return { process: true, text: null };
  }
  if (cacheHitFor({ mtime: cached.mtime, size: cached.size, hash: cached.hash }, mtime, size) !== null) {
    return { process: false };
  }
  if (size !== cached.size) {
    // CHANGED: el tamaño cambió → no hace falta hash
    return { process: true, text: null };
  }
  // AMBIGUO: mtime cambió pero el tamaño es igual → leer + sha256
  const text = await Bun.file(filePath).text();
  if (hashString(text) === cached.hash) {
    // Fue un touch (o una copia con el mismo contenido): sin reprocesar;
    // se actualiza el mtime para revalidar la próxima decisión. El touch se
    // señala para que el estado pendiente lo persista (#2188): sin señal,
    // el mtime mutado en memoria nunca llegaba a state.json y el archivo se
    // re-hasheaba en TODOS los builds siguientes.
    cached.mtime = mtime;
    return { process: false, touched: true };
  }
  return { process: true, text };
}

/** Estadísticas actuales del documento; errores de lectura con hint de ENOENT. */
async function statDocument(cwd: string, relativePath: string): Promise<{ mtime: number; size: number }> {
  try {
    const stat = await Bun.file(join(cwd, relativePath)).stat();
    return { mtime: Math.round(stat.mtimeMs), size: stat.size };
  } catch (err) {
    // Con hint de ENOENT: al leer un documento del usuario el motivo común
    // es un nombre mal escrito o un archivo que nunca existió.
    throw new BuildError(`Error al leer "${relativePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
}

/** Datos normalizados de frontmatter tras procesar un documento cambiado. */
interface IngestedFrontmatter {
  title: string;
  subtitle: string | undefined;
  date: string | undefined;
  creator: string[];
  manualSlug: string | undefined;
  fm: Record<string, unknown> | undefined;
}

/** Datos normalizados de un objeto frontmatter válido. */
interface NormalizedRecord extends Omit<IngestedFrontmatter, 'fm'> {
  rawTitle: unknown;
}

/**
 * Normaliza el record ya parseado: checks compartidos con validate (módulo
 * project-validator) — errores de tipos/slug acumulados aquí como 'field',
 * warnings emitidos igual que validate — y extracción tipada de campos.
 */
function normalizeFrontmatterRecord(record: Record<string, unknown>, relativePath: string, issues: FrontmatterIssue[]): NormalizedRecord {
  // Checks compartidos con validate (módulo project-validator): los
  // errores de tipos y de slug manual abortan el build igual que
  // validate; los warnings (date no ISO, campos ignorados) se
  // muestran en ambos comandos sin romper.
  for (const issue of validateFrontmatterFields(record)) {
    if (issue.severity === 'error') {
      issues.push({ file: relativePath, error: issue.message, kind: 'field' });
    } else {
      logWarning(`${relativePath}: ${issue.message}`, 'discover');
    }
  }
  const rawTitle = record.title;
  return {
    title: typeof rawTitle === 'string' ? rawTitle : '',
    subtitle: fmTrimmedString(record.subtitle),
    date: fmTrimmedString(record.date),
    creator: parseAuthors(record.creator),
    manualSlug: fmTrimmedString(record.slug),
    rawTitle,
  };
}

/**
 * Normaliza y valida el frontmatter de un documento cambiado: parseo YAML,
 * checks compartidos con validate (errores acumulados, warnings emitidos),
 * líneas de ":" sueltas y título ausente. Preserva mensajes y orden exactos.
 */
/** ¿Documento sin título efectivo? Misma condición que valida validate. */
function lacksTitle(normalized: NormalizedRecord | undefined, title: string): boolean {
  return !title && (!normalized || normalized.rawTitle === undefined || normalized.rawTitle === '');
}

function ingestFrontmatter(relativePath: string, text: string, issues: FrontmatterIssue[]): IngestedFrontmatter {
  const { yaml, body } = splitFrontmatter(text);
  let normalized: NormalizedRecord | undefined;
  let fm: Record<string, unknown> | undefined;

  try {
    if (yaml) {
      const yamlResult = parseYamlWithPosition(yaml);
      if (yamlResult.error) throw new Error(yamlResult.error);
      const parsed = yamlResult.value;
      if (parsed && Array.isArray(parsed)) {
        // Mismo criterio que validate: el frontmatter debe ser un objeto.
        issues.push({ file: relativePath, error: 'frontmatter YAML inválido: debe ser un objeto', kind: 'syntax' });
      } else if (parsed && typeof parsed === 'object') {
        fm = parsed as Record<string, unknown>;
        normalized = normalizeFrontmatterRecord(fm, relativePath, issues);
      }
    }
  } catch (err) {
    issues.push({ file: relativePath, error: formatUserError(err), kind: 'syntax' });
  }

  // Líneas de ":" sueltas en el cuerpo: warning compartido con validate
  // (módulo project-validator), emitido solo para documentos reprocesados.
  // El offset suma las líneas del frontmatter (el número apunta al archivo).
  const lineOffset = text.slice(0, text.length - body.length).split('\n').length - 1;
  const looseColons = looseColonLines(body, lineOffset);
  if (looseColons.length > 0) {
    logWarning(`${relativePath}: ${looseColonsMessage(looseColons)}`, 'discover');
  }

  const title = normalized?.title ?? '';
  if (lacksTitle(normalized, title)) {
    // Documento sin título: warning compartido con validate (el pipeline
    // usa "Sin título" como fallback en todos los formatos).
    logWarning(`${relativePath}: ${MISSING_TITLE_WARNING.message}`, 'discover');
  }

  return {
    title,
    subtitle: normalized?.subtitle,
    date: normalized?.date,
    creator: normalized?.creator ?? [],
    manualSlug: normalized?.manualSlug,
    fm,
  };
}

/** Lee el contenido si aún no se tiene; errores de lectura idénticos a stat. */
async function readDocumentText(filePath: string, relativePath: string, pending: string | null): Promise<string> {
  if (pending !== null) return pending;
  try {
    return await Bun.file(filePath).text();
  } catch (err) {
    throw new BuildError(`Error al leer "${relativePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
}

/**
 * Procesa un documento modificado: hashing, ingest de frontmatter y registro
 * en el índice. El slug anterior se preserva SIN aplicar manualSlug:
 * resolveSlugs compara el slug final contra este valor para registrar
 * cambios — sobrescribirlo aquí hacía que los cambios de slug manual nunca
 * se registraran y dejaran huérfanos en dist (#2012).
 */
async function ingestChangedDocument(args: {
  cwd: string;
  relativePath: string;
  filePath: string;
  mtime: number;
  size: number;
  cachedSlug: string | undefined;
  decisionText: string | null;
  index: Map<string, DiscoveryEntry>;
  issues: FrontmatterIssue[];
}): Promise<void> {
  const { relativePath, filePath, mtime, size, decisionText } = args;
  const text = await readDocumentText(filePath, relativePath, decisionText);
  const ingested = ingestFrontmatter(relativePath, text, args.issues);
  args.index.set(relativePath, {
    ...ingested,
    mtime,
    size,
    hash: hashString(text),
    slug: args.cachedSlug,
  });
}

/**
 * Detecta documentos eliminados y captura sus entradas antes de borrarlas.
 * Retorna las claves removidas (ya marcadas como changedPaths) y sus datos.
 */
function takeDeletedEntries(
  index: Map<string, DiscoveryEntry>,
  currentSet: Set<string>,
): { entries: Map<string, DiscoveryEntry>; removed: string[] } {
  const entries = new Map<string, DiscoveryEntry>();
  const removed: string[] = [];
  for (const key of index.keys()) {
    if (!currentSet.has(key)) {
      const entry = index.get(key);
      if (entry) entries.set(key, entry); // la entrada ya lleva el slug resuelto
      removed.push(key);
    }
  }
  for (const key of removed) index.delete(key);
  return { entries, removed };
}

/**
 * Frontmatter inválido: error de build (no publicar degradado). El rótulo
 * distingue la clase real: "YAML inválido" solo para problemas de sintaxis;
 * los errores de validación de campos (tipos, slug) no son un problema de
 * YAML. Con ambas clases se emite un bloque por cada una.
 */
function throwIfInvalidFrontmatter(issues: FrontmatterIssue[]): void {
  if (issues.length === 0) return;
  const blocks: string[] = [];
  for (const kind of ['syntax', 'field'] as const) {
    const byKind = issues.filter((e) => e.kind === kind);
    if (byKind.length === 0) continue;
    const label = kind === 'syntax' ? 'frontmatter YAML inválido' : 'frontmatter inválido';
    const msg = byKind.map((e) => `  ${e.file}: ${e.error}`).join('\n');
    blocks.push(`${label} en ${plural(byKind.length, 'documento')}:\n${msg}`);
  }
  // El código estructural marca SOLO presencia de problemas de sintaxis:
  // es lo que la CLI usa para sugerir validate (los errores de campos ya
  // muestran su detalle completo en el mensaje).
  const hasSyntax = issues.some((e) => e.kind === 'syntax');
  throw new BuildError(blocks.join('\n'), hasSyntax ? BUILD_ERROR_CODES.frontmatterSyntax : undefined);
}

/** ¿Cambió algo que exija persistir estado? Cambios de docs o de hashes de invalidación (#2025). */
function stateHasChanged(useCache: boolean, prevState: BuildState | null, options: DiscoverOptions, anyDocChanges: boolean): boolean {
  return (
    anyDocChanges ||
    !useCache ||
    options.outputDir !== prevState?.outputDir ||
    options.meta?.filtersHash !== prevState?.filtersHash ||
    JSON.stringify(options.meta?.filterFileCache) !== JSON.stringify(prevState?.filterFileCache) ||
    JSON.stringify(options.meta?.configHashes) !== JSON.stringify(prevState?.configHashes) ||
    options.meta?.bibHash !== prevState?.bibHash ||
    JSON.stringify(options.meta?.bibFileCache) !== JSON.stringify(prevState?.bibFileCache)
  );
}

/** Estado pendiente (#2025): discovery NO escribe; el cierre común persiste UNA vez (persistCompletedState). */
function computePendingState(
  useCache: boolean,
  prevState: BuildState | null,
  startedAt: number,
  discoveryIndex: Map<string, DiscoveryEntry>,
  options: DiscoverOptions,
  anyDocChanges: boolean,
  anyTouches = false,
): BuildState | null {
  // Pendiente si hubo cambios (nuevos/modificados/eliminados, hashes de
  // invalidación) o touches (#2188): el mtime actualizado del touch vive solo
  // en discoveryIndex y debe persistirse aunque nada más cambiara, o el
  // archivo se re-hashearía en todos los builds siguientes.
  if (!stateHasChanged(useCache, prevState, options, anyDocChanges || anyTouches)) return null;
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    startedAt,
    activeFormats: options.activeFormats ?? [],
    outputDir: options.outputDir,
    entries: discoveryIndex,
    filtersHash: options.meta?.filtersHash,
    filterFileCache: options.meta?.filterFileCache,
    schemaFileCache: options.meta?.schemaFileCache,
    configHashes: options.meta?.configHashes,
    configFileCache: options.meta?.configFileCache,
    bibHash: options.meta?.bibHash,
    bibFileCache: options.meta?.bibFileCache,
  };
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
export async function discover(cwd: string, options: DiscoverOptions): Promise<DiscoverResultAndPending> {
  // Respetar .gitignore y directorios ignorados: descubrimiento compartido
  // con validate y doctor (única fuente de exclusión de documentos).
  const relativePaths = await listMarkdownDocuments(cwd);

  const useCache = !options.full;
  const prevState = options.prevState;
  const discoveryIndex = useCache ? (prevState?.entries ?? new Map<string, DiscoveryEntry>()) : new Map<string, DiscoveryEntry>();

  const currentSet = new Set(relativePaths);
  const changedPaths = new Set<string>();
  // Dedup de avisos de diacríticos por build (#2090): una vez por title+slug.
  const slugWarningsSeen = new Set<string>();
  // Acumulador de problemas de frontmatter con su clase: 'syntax' (YAML
  // inválido) o 'field' (validación de campos).
  const frontmatterIssues: FrontmatterIssue[] = [];

  const thisBuildStartedAt = Date.now();
  /** Touches detectados (mtime cambió, contenido no): su mtime debe persistir (#2188). */
  let touchedCount = 0;

  // Detectar cambios por archivo con caché content-addressed (mtime+size+hash)
  const FILE_IO_CONCURRENCY = Math.max(1, cpus().length - 1);
  await mapWithConcurrency(relativePaths, FILE_IO_CONCURRENCY, async (relativePath) => {
    const { mtime, size } = await statDocument(cwd, relativePath);
    const cached = useCache ? discoveryIndex.get(relativePath) : undefined;
    const decision = await resolveCacheDecision(cached, join(cwd, relativePath), mtime, size);
    if (!decision.process) {
      if (decision.touched) touchedCount++;
      return; // Archivos sin cambios: conservan su entrada en discoveryIndex
    }

    changedPaths.add(relativePath);
    await ingestChangedDocument({
      cwd,
      relativePath,
      filePath: join(cwd, relativePath),
      mtime,
      size,
      cachedSlug: discoveryIndex.get(relativePath)?.slug,
      decisionText: decision.text,
      index: discoveryIndex,
      issues: frontmatterIssues,
    });
  });

  // Detectar eliminados y capturar sus datos antes de borrarlos del índice
  const { entries: deletedEntries, removed: deletedFiles } = takeDeletedEntries(discoveryIndex, currentSet);
  for (const key of deletedFiles) changedPaths.add(key);

  throwIfInvalidFrontmatter(frontmatterIssues);

  // Resolver slugs via slug-resolver
  const slugResult = resolveSlugs(discoveryIndex, (meta, opts) => {
    // computeSlug solo retorna undefined sin fallbackPath; aqui siempre se provee
    const slug = computeSlug(meta, opts);
    if (slug === undefined) throw new BuildError(`no se pudo resolver el slug de ${opts.fallbackPath}`);
    if (meta.title) {
      const diacriticHint = slugDiacriticWarning(meta.title, slug);
      if (diacriticHint && !slugWarningsSeen.has(diacriticHint)) {
        slugWarningsSeen.add(diacriticHint);
        logWarning(diacriticHint, 'discover');
      }
    }
    return slug;
  });
  const slugChangedEntries = new Map<string, string>(slugResult.slugChangedEntries);
  for (const path of slugResult.changedPaths) changedPaths.add(path);

  const pendingState = computePendingState(useCache, prevState, thisBuildStartedAt, discoveryIndex, options, changedPaths.size > 0, touchedCount > 0);

  return { relativePaths, changedPaths, discoveryIndex, deletedEntries, slugChangedEntries, pendingState };
}

/**
 * Construye BuildDocument[] con frontmatter desde discoveryIndex.
 * Solo title y creator — el resto usa valores por defecto.
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
        creator: entry?.creator ?? [],
      },
    };
  });
}

/**
 * Parsea el campo creator del frontmatter. Acepta tanto string simple
 * como array de strings; filtra valores que no sean texto y retorna un
 * array vacío si el campo está ausente, es nulo o está vacío.
 */
export function parseAuthors(raw: unknown): string[] {
  return fmStringList(raw) ?? [];
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
