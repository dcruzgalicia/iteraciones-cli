import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { IGNORED_DIRS } from '../builder/discover.js';
import type { Frontmatter } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../lib/errors.js';
import { checkLatexEngine } from './doctor/system-checks.js';

type ValidationError = { file: string; message: string };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

interface ParsedFile {
  frontmatter: Frontmatter;
  body: string;
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function emptyFrontmatter(): Frontmatter {
  return {
    title: '',
    date: '',
    author: [],
    type: '',
    keywords: [],
  };
}

function normalizeFrontmatter(data: Record<string, unknown>): Frontmatter {
  return {
    ...data,
    title: typeof data.title === 'string' ? data.title : '',
    date: typeof data.date === 'string' ? data.date : data.date instanceof Date ? data.date.toISOString().slice(0, 10) : '',
    author: normalizeStringList(data.author),
    type: typeof data.type === 'string' ? data.type : '',
    keywords: Array.isArray(data.keywords) ? data.keywords.filter((k): k is string => typeof k === 'string') : [],
  };
}

function parseFrontmatter(raw: string): ParsedFile {
  const match = raw.match(FRONTMATTER_RE);

  if (!match) return { frontmatter: emptyFrontmatter(), body: raw };

  let data: Record<string, unknown> = {};
  try {
    const parsed = Bun.YAML.parse(match[1] ?? '');
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.getPrototypeOf(parsed) === Object.prototype) {
      data = parsed as Record<string, unknown>;
    } else {
      return { frontmatter: emptyFrontmatter(), body: raw };
    }
  } catch {
    return { frontmatter: emptyFrontmatter(), body: raw };
  }

  const body = raw.slice(match[0].length);

  return { frontmatter: normalizeFrontmatter(data), body };
}

// theme se pasa desde runValidate para evitar que loadSiteConfig se llame dos veces
// (una en validateConfig + otra aquí), lo que duplicaría los warnings de stderr.
type ValidationResult = {
  errors: ValidationError[];
  warnings: ValidationError[];
};

async function validateFrontmatter(cwd: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const entries: string[] = [];
  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    entries.push(entry);
  }
  // Ordenar para salida determinista independiente del sistema de archivos.
  entries.sort();

  for (const entry of entries) {
    const absPath = join(cwd, entry);
    let raw: string;
    try {
      raw = await readFile(absPath, 'utf8');
    } catch (err) {
      errors.push({
        file: entry,
        message: `no se pudo leer: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const match = FRONTMATTER_RE.exec(raw);
    if (!match) continue; // sin frontmatter → válido (type: 'file' por defecto)

    // Validar sintaxis YAML y normalizar el frontmatter en un solo paso.
    let parsed: Record<string, unknown>;
    let fm: ReturnType<typeof parseFrontmatter>['frontmatter'];
    try {
      const result = Bun.YAML.parse(match[1] ?? '');
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        errors.push({
          file: entry,
          message: 'frontmatter YAML inválido: debe ser un objeto',
        });
        continue;
      }
      parsed = result as Record<string, unknown>;
      fm = parseFrontmatter(raw).frontmatter;
    } catch (err) {
      errors.push({
        file: entry,
        message: `frontmatter YAML inválido: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Validar rutas de archivos editoriales (editorial.cover, .bibliography, .csl).
    const rawEditorial =
      typeof parsed['editorial'] === 'object' && parsed['editorial'] !== null ? (parsed['editorial'] as Record<string, unknown>) : null;

    if (rawEditorial) {
      const editorialPaths: Array<[string, string]> = [
        ['editorial.cover', typeof rawEditorial['cover'] === 'string' ? rawEditorial['cover'] : ''],
        ['editorial.bibliography', typeof rawEditorial['bibliography'] === 'string' ? rawEditorial['bibliography'] : ''],
        ['editorial.csl', typeof rawEditorial['csl'] === 'string' ? rawEditorial['csl'] : ''],
      ];
      for (const [fieldName, fieldValue] of editorialPaths) {
        if (!fieldValue) continue;
        const absFilePath = join(cwd, fieldValue);
        const fileExists = await stat(absFilePath)
          .then((s) => s.isFile())
          .catch(() => false);
        if (!fileExists) {
          errors.push({
            file: entry,
            message: `${fieldName}: "${fieldValue}" no existe en el proyecto`,
          });
        }
      }
    }
  }
  return { errors, warnings };
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * Incluye validación semántica: tipos, regiones, items de colecciones y templates.
 * No ejecuta la compilación completa.
 */
export async function runValidate(cwd: string): Promise<void> {
  let hasPdf = false;
  const configErrors: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    hasPdf = !!config.format?.pdf;
  } catch (err) {
    if (err instanceof ConfigError) {
      configErrors.push({
        file: relative(cwd, err.configPath),
        message: err.message,
      });
    } else {
      configErrors.push({
        file: '_iteraciones.yaml',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Si format.pdf esta configurado, verificar que el motor LaTeX este disponible.
  if (hasPdf) {
    const latexResult = await checkLatexEngine('pdflatex');
    if (!latexResult.ok) {
      configErrors.push({
        file: '_iteraciones.yaml',
        message: 'format.pdf requiere pdflatex pero no esta disponible — ' + (latexResult.detail ?? ''),
      });
    }
  }
  const { errors: fmErrors, warnings } = await validateFrontmatter(cwd);
  const errors = [...configErrors, ...fmErrors];

  if (warnings.length > 0) {
    process.stderr.write(`validate: ${warnings.length} advertencia(s):\n`);
    for (const w of warnings) {
      process.stderr.write(`  ⚠ ${w.file}: ${w.message}\n`);
    }
  }

  if (errors.length === 0) {
    process.stdout.write('validate: sin errores.\n');
    return;
  }

  process.stderr.write(`validate: se encontraron ${errors.length} error(es):\n`);
  for (const e of errors) {
    process.stderr.write(`  ✖ ${e.file}: ${e.message}\n`);
  }
  process.exitCode = 1;
}
