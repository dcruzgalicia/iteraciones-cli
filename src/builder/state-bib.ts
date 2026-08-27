import { isAbsolute, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { ConfigError } from '../lib/errors.js';
import type { BibOptions } from '../lib/pandoc-runner.js';
import { isIgnoredByRules, isInsideIgnoredDir, loadGitignoreRules } from './gitignore.js';
import { type FileCacheEntry, hashFileCached } from './state-hash.js';
import { hashString } from './state-serialize.js';

/**
 * Descubre archivos de bibliografía del proyecto. Bun.Glob omite por defecto
 * los directorios ocultos (`.iteraciones/`, `.git/`); los directorios visibles
 * no deseados (node_modules, dist) se excluyen en cualquier profundidad.
 * @param extensions Extensiones a incluir (default: bib y csl).
 */
export async function discoverBibFiles(cwd: string, extensions: string[] = ['bib', 'csl']): Promise<string[]> {
  const results: string[] = [];
  const gitignoreRules = await loadGitignoreRules(cwd);
  try {
    const glob = new Bun.Glob(`**/*.{${extensions.join(',')}}`);
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^[/\\]+/, '');
      if (isInsideIgnoredDir(rel)) continue;
      if (isIgnoredByRules(rel, gitignoreRules)) continue;
      results.push(file);
    }
  } catch (err) {
    // Política única de ENOENT (#2020, aplicada a bib en #2078): solo la
    // ausencia es "sin bibliografía"; cualquier otro error de escaneo se
    // propaga — tragarlo convertía EACCES/EMFILE en un build sin citas.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  return results.sort();
}

/** Entrada de caché de archivo de bibliografía (mtime+size evitan re-leer contenido). */
interface BibFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type BibFileCache = Record<string, BibFileCacheEntry>;

/** Hash del contenido de un archivo de bibliografía, reutilizando el caché si mtime+size coinciden. */
async function hashBibFile(abs: string, prevCache: BibFileCache | undefined, cache: BibFileCache): Promise<string> {
  // Núcleo único (#2020). Cambio de contrato documentado (decisión del issue):
  // antes CUALQUIER error se tragaba devolviendo hash de contenido vacío;
  // ahora solo ENOENT es tolerado (⇒ parte vacía en el hash, señal
  // determinista de ausencia) y cualquier otro error se propaga.
  const hash = await hashFileCached(abs, abs, prevCache, cache);
  const entry = hash !== null ? hash : hashString('');
  cache[abs] =
    cache[abs] ??
    ({
      mtime: 0,
      size: 0,
      hash: entry,
    } as FileCacheEntry);
  return entry;
}

/**
 * Hash del contenido de los archivos de bibliografía efectivos (los que el
 * pipeline realmente usa). Con `bibliography` configurada: esa ruta y el CSL
 * configurado. Sin configurar: todos los .bib/.csl del proyecto (la capa
 * LaTeX referencia todos los .bib descubiertos).
 *
 * Con `prevCache` (de state.json), cada archivo se compara por mtime+size:
 * si no cambió, se reutiliza su hash sin leer el contenido.
 */
export async function computeBibHash(cwd: string, siteConfig?: SiteConfig, prevCache?: BibFileCache): Promise<{ hash: string; cache: BibFileCache }> {
  const parts: string[] = [];
  const cache: BibFileCache = {};
  const files: string[] = [];
  let usesPackagedCsl = true;
  const configuredBib = siteConfig?.bibliography?.trim();
  if (configuredBib) {
    files.push(resolveConfiguredPath(cwd, configuredBib));
    const configuredCsl = siteConfig?.csl?.trim();
    if (configuredCsl) {
      files.push(resolveConfiguredPath(cwd, configuredCsl));
      usesPackagedCsl = false;
    }
  } else {
    files.push(...(await discoverBibFiles(cwd)));
  }
  for (const file of files) {
    parts.push(file, await hashBibFile(file, prevCache, cache));
  }
  // Sin CSL configurado las citas usan el APA-7 empaquetado: su contenido
  // participa en la invalidación — actualizar el paquete cambia el estilo y
  // las exportaciones deben regenerarse (#2024).
  if (usesPackagedCsl) {
    const packagedCsl = join(import.meta.dir, '../lib/resources/apa-7.csl');
    parts.push('packaged-csl', await hashBibFile(packagedCsl, prevCache, cache));
  }
  return { hash: hashString(parts.join('\0')), cache };
}

/** Resuelve una ruta configurada (bibliography/csl) contra la raíz del proyecto. */
export function resolveConfiguredPath(cwd: string, rel: string): string {
  return isAbsolute(rel) ? rel : join(cwd, rel);
}

/**
 * Resuelve las opciones de bibliografía compartidas para exportaciones.
 * Con `bibliography` configurada (raíz de la config) se usa esa ruta y el CSL
 * configurado (o el APA-7 empaquetado). Sin configurar: auto-descubrimiento
 * del primer .bib del proyecto con APA-7.
 *
 * Contrato único (decisión D1, issue #2164): una ruta configurada inexistente
 * es config inválida y lanza ConfigError — sin fallback al auto-descubrimiento
 * (el auto-descubrimiento solo aplica cuando no se configuró nada). El build
 * real nunca llega aquí con ruta ausente: la validación de config
 * (`validateConfigFilePaths`) falla antes; este guard mantiene la paridad si
 * el orden de las fases cambiara.
 */
export async function resolveBibOptions(cwd: string, siteConfig?: SiteConfig): Promise<{ bibFiles: string[]; bibOptions?: BibOptions }> {
  const configuredBib = siteConfig?.bibliography?.trim();
  if (configuredBib) {
    const bibPath = resolveConfiguredPath(cwd, configuredBib);
    if (!(await Bun.file(bibPath).exists())) {
      throw new ConfigError(
        `iteraciones.config.yaml: bibliography: "${configuredBib}" no encontrado en el proyecto`,
        join(cwd, 'iteraciones.config.yaml'),
      );
    }
    const configuredCsl = siteConfig?.csl?.trim();
    const cslPath = configuredCsl ? resolveConfiguredPath(cwd, configuredCsl) : join(import.meta.dir, '../../src/lib/resources/apa-7.csl');
    return { bibFiles: [bibPath], bibOptions: { bibliography: bibPath, csl: cslPath } };
  }
  const bibFiles = cwd ? await discoverBibFiles(cwd, ['bib']) : [];
  const firstBib = bibFiles[0];
  const bibOptions = firstBib !== undefined ? { bibliography: firstBib, csl: join(import.meta.dir, '../../src/lib/resources/apa-7.csl') } : undefined;
  return { bibFiles, bibOptions };
}
