import { join } from 'node:path';

/**
 * Soporte de reglas de .gitignore para el descubrimiento de documentos.
 *
 * Implementa los patrones comunes de git: negación (!), directorios (trailing
 * /), anclaje a la raíz (/ o slash interior), * ** ? y clases [..].
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
  /** Regex compilada del patrón (sin anclas). */
  regex: RegExp;
}

/** Convierte un patrón de gitignore a una expresión regular (sin anclas). */
function patternToRegex(pattern: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'; // **/ — cualquier número de directorios
          i += 3;
        } else {
          out += '.*'; // ** — cualquier cosa, incluyendo /
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        out += '\\[';
        i += 1;
      } else {
        out += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      const ch = pattern[i];
      if (ch === undefined) break;
      out += ch.replace(/[.+^${}()|\\]/g, '\\$&');
      i += 1;
    }
  }
  return out;
}

/**
 * Parsea el contenido de un .gitignore en reglas ordenadas.
 * Las líneas vacías y los comentarios (#) se ignoran.
 */
export function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split('\n')) {
    let line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!')) {
      // '\!' es un literal !, no negación
      line = line.slice(1);
    }
    if (!line) continue;

    if (line.startsWith('/')) line = line.slice(1); // /patrón → anclado a la raíz
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;

    const anchored = line.includes('/');
    rules.push({ pattern: line, negated, anchored, dirOnly, regex: new RegExp(`^${patternToRegex(line)}$`) });
  }
  return rules;
}

/**
 * Determina si un path relativo está ignorado por las reglas.
 * La última regla que matchea gana (estándar git).
 */
export function isIgnoredByRules(relPath: string, rules: GitignoreRule[]): boolean {
  if (rules.length === 0) return false;

  const path = relPath.replace(/^\.\//, '');
  const segments = path.split('/');

  let ignored = false;
  for (const rule of rules) {
    let matched = false;

    if (rule.dirOnly) {
      // Matchea el directorio o cualquier cosa dentro de él
      if (rule.anchored) {
        matched = path === rule.pattern || path.startsWith(rule.pattern + '/');
      } else {
        matched = segments.some((seg, idx) => {
          if (!rule.regex.test(seg)) return false;
          return idx < segments.length - 1 || path === rule.pattern;
        });
      }
    } else if (rule.anchored) {
      matched = rule.regex.test(path);
    } else {
      // No anclado: matchea contra el nombre de cualquier componente (archivo o dir)
      matched = segments.some((seg) => rule.regex.test(seg));
    }

    if (matched) ignored = !rule.negated;
  }
  return ignored;
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
 * Retorna true si algún segmento del path relativo empieza con '.' (dotfile:
 * archivo o carpeta oculta). Es una regla independiente de .gitignore: los
 * nombres que empiezan con . son ocultos por convención de git/shell y nunca
 * deben procesarse como contenido editorial.
 */
export function isHiddenPath(relPath: string): boolean {
  return relPath.split('/').some((segment) => segment !== '.' && segment !== '..' && segment.startsWith('.'));
}
