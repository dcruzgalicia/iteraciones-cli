import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_EPUB_FORMAT, DEFAULT_HTML_FORMAT, DEFAULT_PAGINATION, DEFAULT_PDF_FORMAT, DEFAULT_SITE_CONFIG } from '../config/site-config.js';

const DEFAULT_README = `---
title: Inicio
---

# Inicio

Escribe tu contenido aquí.
`;

/**
 * Genera un _iteraciones.yaml completo con todas las opciones posibles
 * y sus valores por defecto. Útil como referencia para nuevos usuarios.
 */
function buildDefaultConfig(): string {
  const pdfDefaults = DEFAULT_PDF_FORMAT;
  const lines: string[] = [];

  // ── site ──
  lines.push('site:');
  lines.push(`  title: ${yamlStr(DEFAULT_SITE_CONFIG.title)}`);
  lines.push(`  tagline: ${yamlStr(DEFAULT_SITE_CONFIG.tagline)}`);
  lines.push(`  lang: ${yamlStr(DEFAULT_SITE_CONFIG.lang)}`);
  lines.push(`  logo: ${yamlStr(DEFAULT_SITE_CONFIG.logo)}`);
  lines.push(`  base-url: ${yamlStr(DEFAULT_SITE_CONFIG.baseUrl ?? '')}`);
  lines.push('');

  // ── plugins ──
  lines.push('plugins: []');
  lines.push('');

  // ── pagination ──
  lines.push('pagination:');
  lines.push(`  limit: ${DEFAULT_PAGINATION.limit}`);
  lines.push('');

  // ── format ──
  lines.push('format:');

  // html
  lines.push('  html:');
  lines.push(`    theme: dark`);
  lines.push(`    accent: ${DEFAULT_HTML_FORMAT.accent}`);
  lines.push(`    math: ${DEFAULT_HTML_FORMAT.math}`);
  lines.push(`    toc: ${yamlBool(DEFAULT_HTML_FORMAT.toc)}`);
  lines.push(`    toc-depth: ${DEFAULT_HTML_FORMAT.tocDepth}`);
  lines.push(`    hyphenation: ${yamlBool(DEFAULT_HTML_FORMAT.hyphenation)}`);

  // pdf
  lines.push('  pdf:');
  for (const [key, value] of Object.entries(pdfDefaults)) {
    if (key === 'margins') continue; // Se renderiza en bloque abajo
    const yamlKey = camelToKebab(key);
    lines.push(`    ${yamlKey}: ${yamlValue(value)}`);
  }
  // Margins en formato bloque YAML para mejor legibilidad
  lines.push('    margins:');
  for (const m of DEFAULT_PDF_FORMAT.margins!) {
    lines.push(`      - ${yamlStr(m)}`);
  }
  // Opciones adicionales que no están en DEFAULT_PDF_FORMAT
  // pero son configurables según la interfaz PdfFormatConfig
  lines.push('    documentclass: scrartcl');
  lines.push('    top-level-division: section');
  lines.push('    sfdefaults: false');
  lines.push('    respect-header-plain: false');

  // epub
  lines.push('  epub:');
  for (const [key, value] of Object.entries(DEFAULT_EPUB_FORMAT)) {
    const yamlKey = camelToKebab(key);
    if (value !== undefined) {
      lines.push(`    ${yamlKey}: ${yamlValue(value)}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Convierte camelCase a kebab-case para usar como keys YAML.
 */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Serializa un valor a YAML, manejando strings, booleanos y números.
 */
function yamlValue(value: unknown): string {
  if (typeof value === 'string') {
    return yamlStr(value);
  }
  if (typeof value === 'boolean') {
    return yamlBool(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value === undefined || value === null) {
    return '~';
  }
  return String(value);
}

/**
 * Serializa un string a YAML, añadiendo comillas cuando es necesario
 * para evitar ambigüedades (valores parecidos a booleanos, números, etc.).
 */
function yamlStr(s: string): string {
  // Si está vacío, siempre con comillas
  if (s === '') return '""';
  // Valores YAML ambiguos que necesitan comillas
  if (/^(true|false|yes|no|on|off|null|undefined|~)$/i.test(s)) return `"${s}"`;
  if (/^\d+(\.\d+)?$/.test(s)) return `"${s}"`;
  if (/^0x[0-9a-f]+$/i.test(s)) return `"${s}"`;
  if (/^['"!@#%&*[\]{}|>:`]/d.test(s) || /[\s,:]#/.test(s)) return `"${s}"`;
  // Contiene caracteres que requieren comillas dobles por escape
  if (/[\\"\n\t]/.test(s)) return JSON.stringify(s);
  return s;
}

/**
 * Serializa un booleano a YAML.
 */
function yamlBool(b: boolean): string {
  return b ? 'true' : 'false';
}

/**
 * Crea `_iteraciones.yaml` y `README.md` en el directorio indicado.
 * Si alguno de los archivos ya existe, lo omite e informa al usuario.
 */
export async function runInit(cwd: string): Promise<void> {
  const [configCreated, readmeCreated] = await Promise.all([
    createExclusive(join(cwd, '_iteraciones.yaml'), buildDefaultConfig()),
    createExclusive(join(cwd, 'README.md'), DEFAULT_README),
  ]);

  process.stdout.write(configCreated ? 'init: creado _iteraciones.yaml\n' : 'init: omitido _iteraciones.yaml (ya existe)\n');
  process.stdout.write(readmeCreated ? 'init: creado README.md\n' : 'init: omitido README.md (ya existe)\n');
}

/**
 * Intenta crear el archivo con la bandera exclusiva `wx`.
 * Retorna true si se creó, false si ya existía (EEXIST).
 * Re-lanza cualquier otro error (EACCES, ENOTDIR, etc.).
 */
async function createExclusive(filePath: string, content: string): Promise<boolean> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}
