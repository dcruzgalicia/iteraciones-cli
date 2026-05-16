import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../errors.js';
import { FRONTMATTER_RE } from '../loader/frontmatter.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

type ValidationError = { file: string; message: string };

async function validateConfig(cwd: string): Promise<ValidationError[]> {
  try {
    await loadSiteConfig(cwd);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) {
      return [{ file: relative(cwd, err.configPath), message: err.message }];
    }
    return [{ file: '_iteraciones.yaml', message: err instanceof Error ? err.message : String(err) }];
  }
}

async function validateFrontmatter(cwd: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

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
      // Un error de lectura impide validar el archivo; se registra como error.
      errors.push({ file: entry, message: `no se pudo leer: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    const match = FRONTMATTER_RE.exec(raw);
    if (!match) continue; // sin frontmatter → válido

    try {
      Bun.YAML.parse(match[1] ?? '');
    } catch (err) {
      errors.push({ file: entry, message: `frontmatter YAML inválido: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return errors;
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * No ejecuta la compilación completa.
 */
export async function runValidate(cwd: string): Promise<void> {
  const [configErrors, frontmatterErrors] = await Promise.all([validateConfig(cwd), validateFrontmatter(cwd)]);
  const errors = [...configErrors, ...frontmatterErrors];

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
