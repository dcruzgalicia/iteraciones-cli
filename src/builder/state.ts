import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { logWarning } from '../lib/logger.js';
import type { DiscoveryEntry } from './types.js';

/** Ruta relativa del archivo de estado del build dentro del proyecto. */
export const STATE_PATH = join('.iteraciones', 'changes', 'state.json');

/** Plantilla HTML del paquete (participa en la invalidación del formato HTML). */
const TEMPLATE_PATH = join(import.meta.dir, '../../src/lib/resources/template.html');

/** Contenido completo de state.json (caché content-addressed del build). */
export interface StateFile {
  startedAt: number;
  activeFormats: string[];
  /** Hash de los transpilers efectivos (paquete + proyecto) y sus disabled lists. */
  transpilerHash?: string;
  /** Hash de configuración por formato (pdf, html, epub, markdown). */
  configHashes?: Record<string, string>;
  /** Hash de los archivos .bib y .csl del proyecto. */
  bibHash?: string;
  /** Accent usado en el último CSS generado (regeneración de Tailwind). */
  cssAccent?: string;
  /** Índice de descubrimiento: path relativo → entry con frontmatter y caché. */
  entries: Record<string, DiscoveryEntry>;
}

export function hashString(input: string): string {
  return Bun.CryptoHasher.hash('sha256', input, 'hex');
}

export async function hashFileContent(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return Bun.CryptoHasher.hash('sha256', bytes, 'hex');
}

export async function loadStateFile(cwd: string): Promise<StateFile | null> {
  const file = Bun.file(join(cwd, STATE_PATH));
  if (!(await file.exists())) return null;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<StateFile>;
    if (typeof parsed.startedAt !== 'number') return null;
    return {
      startedAt: parsed.startedAt,
      activeFormats: Array.isArray(parsed.activeFormats) ? parsed.activeFormats : [],
      transpilerHash: parsed.transpilerHash,
      configHashes: parsed.configHashes,
      bibHash: parsed.bibHash,
      cssAccent: parsed.cssAccent,
      entries: (parsed.entries ?? {}) as Record<string, DiscoveryEntry>,
    };
  } catch (err) {
    // state.json corrupto (build interrumpido a mitad de escritura): se ignora y se hará build completo
    logWarning(`no se pudo leer state.json; se hará build completo: ${String(err)}`, 'cache');
    return null;
  }
}

/**
 * Guarda state.json de forma atómica (temp + rename): un build interrumpido
 * nunca deja el caché a medias.
 */
export async function saveStateFile(cwd: string, state: StateFile): Promise<void> {
  const filePath = join(cwd, STATE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(state));
  try {
    await rename(tmpPath, filePath);
  } catch {
    // El destino ya existe en algunos sistemas (Windows): se elimina y se reintenta el rename
    await rm(filePath, { force: true });
    await rename(tmpPath, filePath);
  }
}

/**
 * Hash de los transpilers efectivos (paquete + proyecto) y de los preamble
 * transpilers, incluyendo las disabled lists. Cambia solo si el código de un
 * transpiler o la lista de desactivados cambia.
 */
export async function computeTranspilerHash(cwd: string, siteConfig: SiteConfig): Promise<string> {
  const parts: string[] = [];
  // [directorio, glob]: filtros Lua del paquete y del proyecto, preamble .tex
  const specs: Array<[string, string]> = [
    [join(import.meta.dir, '../lib/resources/transpilers'), '**/*.lua'],
    [join(import.meta.dir, '../lib/resources/preamble'), '*.tex'],
    [join(cwd, 'transpilers'), '**/*.lua'],
    [join(cwd, 'preamble'), '*.tex'],
  ];
  for (const [dir, glob] of specs) {
    try {
      const files = [...new Bun.Glob(glob).scanSync({ cwd: dir })].sort();
      for (const file of files) {
        parts.push(file, await Bun.file(join(dir, file)).text());
      }
    } catch {
      // Directorio inexistente (transpilers/preamble del proyecto son opcionales)
    }
  }
  // Filtros Lua de usuario (`lua-filters:`) — pueden estar en cualquier directorio
  for (const rel of siteConfig.luaFilters ?? []) {
    const content = await Bun.file(join(cwd, rel))
      .text()
      .catch(() => '');
    parts.push(rel, content);
  }
  parts.push(JSON.stringify(siteConfig.disabledTranspilers ?? []));
  parts.push(JSON.stringify(siteConfig.disabledPreambleTranspilers ?? []));
  return hashString(parts.join('\0'));
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
  const site = JSON.stringify({
    title: siteConfig.title,
    tagline: siteConfig.tagline,
    lang: siteConfig.lang,
    'base-url': siteConfig.baseUrl,
    logo: siteConfig.logo,
  });
  const htmlTemplate = await Bun.file(TEMPLATE_PATH)
    .text()
    .catch(() => '');
  const logo = siteConfig.logo?.trim() ? await hashFileContent(join(cwd, siteConfig.logo)).catch(() => '') : '';
  return {
    pdf: hashString(`${JSON.stringify(fmt?.pdf ?? {})}\n${String(fmt?.latex ?? false)}`),
    html: hashString(`${JSON.stringify(fmt?.html ?? {})}\n${htmlTemplate}\n${site}\n${logo}`),
    epub: hashString(`${JSON.stringify(fmt?.epub ?? {})}`),
    markdown: hashString(`${JSON.stringify(fmt?.markdown ?? {})}\n${String(siteConfig.lang ?? '')}`),
  };
}

/**
 * Descubre archivos de bibliografía del proyecto (excluye node_modules,
 * .iteraciones, dist, .git). Unifica la implementación que antes vivía
 * duplicada en latex-preamble.ts (solo .bib).
 * @param extensions Extensiones a incluir (default: bib y csl).
 */
export function discoverBibFiles(cwd: string, extensions: string[] = ['bib', 'csl']): string[] {
  const results: string[] = [];
  try {
    const glob = new Bun.Glob(`**/*.{${extensions.join(',')}}`);
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^[/\\]+/, '');
      if (rel.startsWith('node_modules/') || rel.startsWith('.iteraciones/') || rel.startsWith('dist/') || rel.startsWith('.git/')) continue;
      results.push(file);
    }
  } catch {
    // Sin archivos de bibliografía
  }
  return results.sort();
}

/** Hash del contenido de todos los .bib y .csl del proyecto. */
export async function computeBibHash(cwd: string): Promise<string> {
  const parts: string[] = [];
  for (const file of discoverBibFiles(cwd)) {
    parts.push(
      file,
      await Bun.file(file)
        .text()
        .catch(() => ''),
    );
  }
  return hashString(parts.join('\0'));
}
