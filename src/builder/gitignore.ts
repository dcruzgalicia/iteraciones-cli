import { join } from 'node:path';
import ignore from 'ignore';

/**
 * Soporte de reglas de .gitignore para el descubrimiento de documentos.
 *
 * El parseo de reglas (forma expuesta a la API) es propio; el matcheo delega en
 * la librería `ignore` (la misma que usa eslint), que implementa la semántica
 * completa de git (última regla gana, negación, anclajes, `**`, escapes).
 * Alcance: solo el .gitignore de la raíz del proyecto.
 */

export interface GitignoreRule {
  /** Patrón limpio (sin !, sin / final, sin / inicial). */
  pattern: string;
  /** true si la regla comienza con ! (re-incluye). */
  negated: boolean;
  /** true si el patrón contiene / (relativo a la raíz del proyecto). */
  anchored: boolean;
  /** true si el patrón termina con / (solo directorios). */
  dirOnly: boolean;
}

/** Reglas con el matcher `ignore` compilado, en una propiedad no enumerable. */
interface GitignoreRules extends Array<GitignoreRule> {
  __gitignoreMatcher?: ignore.Ignore;
}

/** Propiedad no enumerable que guarda el matcher compilado del contenido. */
const MATCHER_KEY = '__gitignoreMatcher';

/**
 * Motor de matching puro por línea: clasifica una línea cruda del
 * .gitignore en su regla normalizada.
 *   - vacías y comentarios (#) → undefined
 *   - '!' inicial → negada; '\\!' → literal !
 *   - '/' inicial o presencia de '/' interna → anclada a la raíz
 *   - '/' final → solo directorios
 */
export function parseGitignoreLine(rawLine: string): GitignoreRule | undefined {
  let line = rawLine.trimEnd();
  if (!line || line.startsWith('#')) return undefined;

  let negated = false;
  if (line.startsWith('!')) {
    negated = true;
    line = line.slice(1);
  } else if (line.startsWith('\\!')) {
    // '\!' es un literal !, no negación
    line = line.slice(1);
  }
  if (!line) return undefined;

  // El anclaje incluye el / inicial (se elimina del patrón pero marca el
  // anclaje: '/raiz.md' solo matchea 'raiz.md', no 'sub/raiz.md').
  const anchoredAtRoot = line.startsWith('/');
  if (line.startsWith('/')) line = line.slice(1); // /patrón → anclado a la raíz
  let dirOnly = false;
  if (line.endsWith('/')) {
    dirOnly = true;
    line = line.slice(0, -1);
  }
  if (!line) return undefined;

  return { pattern: line, negated, anchored: anchoredAtRoot || line.includes('/'), dirOnly };
}

/**
 * Parsea el contenido de un .gitignore en reglas ordenadas.
 * Las líneas vacías y los comentarios (#) se ignoran.
 * El matcher de la librería `ignore` queda compilado en una propiedad no
 * enumerable del array: cada elemento conserva su forma pública y las
 * comparaciones de longitud/campos en los tests no se ven afectadas.
 */
export function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split('\n')) {
    const rule = parseGitignoreLine(rawLine);
    if (rule) rules.push(rule);
  }

  Object.defineProperty(rules, MATCHER_KEY, { value: ignore().add(content) });
  return rules;
}

/** Retorna el matcher compilado si las reglas provienen de parseGitignore. */
function matcherOf(rules: GitignoreRule[]): ignore.Ignore | undefined {
  return (rules as GitignoreRules).__gitignoreMatcher;
}

/**
 * Determina si un path relativo está ignorado por las reglas.
 * La última regla que matchea gana (semántica de git, implementada por
 * `ignore`, incluyendo la precedencia de directorios excluidos).
 */
export function isIgnoredByRules(relPath: string, rules: GitignoreRule[]): boolean {
  if (rules.length === 0) return false;
  const matcher = matcherOf(rules);
  if (matcher === undefined) return false;
  // La librería no normaliza el prefijo './' ('./a.md' con '*.md' → false).
  return matcher.ignores(relPath.replace(/^\.\//, ''));
}

/**
 * Lee y parsea el .gitignore de la raíz del proyecto.
 * Retorna una lista vacía si el archivo no existe o no se puede leer.
 */
export async function loadGitignoreRules(cwd: string): Promise<GitignoreRule[]> {
  const file = Bun.file(join(cwd, '.gitignore'));
  if (!(await file.exists())) return [];
  try {
    return parseGitignore(await file.text());
  } catch {
    return [];
  }
}

/**
 * Directorios que nunca se procesan como contenido editorial, en cualquier
 * profundidad (como git): dependencias, metadatos de git, salidas y caché.
 * Los directorios ocultos (prefijo .) los omite Bun.Glob por sí mismo.
 */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

/**
 * Retorna true si algún segmento del path relativo es un directorio ignorado
 * (node_modules, .git, dist, .iteraciones) en cualquier profundidad.
 * Ej: 'docs/node_modules/x.md' → true.
 */
export function isInsideIgnoredDir(relPath: string): boolean {
  return relPath.split('/').some((segment) => IGNORED_DIRS.has(segment));
}

/**
 * Lista los documentos Markdown del proyecto: orden determinista (alfabético),
 * excluyendo dotfiles (Bun.Glob), directorios ignorados y las reglas del
 * .gitignore de la raíz. Única implementación del descubrimiento: discover,
 * validate y el conteo de doctor la consumen (antes se triplicaba el patrón).
 */
export async function listMarkdownDocuments(cwd: string): Promise<string[]> {
  const entries: string[] = [];
  const gitignoreRules = await loadGitignoreRules(cwd);
  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    if (isInsideIgnoredDir(entry)) continue;
    if (isIgnoredByRules(entry, gitignoreRules)) continue;
    entries.push(entry);
  }
  entries.sort();
  return entries;
}
