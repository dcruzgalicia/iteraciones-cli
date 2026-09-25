import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { recordSupportCommand } from '../lib/script-recorder.js';
import { pruneEmptyDirs } from './cleanup.js';
import { projectPreambleDirs } from './preamble-loader.js';
import { resolveBibOptions } from './state-bib.js';

/**
 * #2448 — `bundle: true` replica en `dist/files` los insumos de los que dependen
 * las salidas, para que una copia de esa carpeta vuelva a construir el mismo
 * build: la config (sin ella no arranca), los overrides de preamble y de
 * filtros, y la bibliografía. Van con su ruta relativa a la raíz.
 *
 * La lista de lo copiado vive en `.iteraciones/bundle.json` para retirar en la
 * siguiente corrida lo que dejó de corresponder (o todo, si se apaga). El build
 * la sincroniza al final; `build.sh` repite el mismo `iteraciones bundle`.
 */
const CONFIG_FILE = 'iteraciones.config.yaml';
const FILTERS_DIR = 'filters';
const MANIFEST = join('.iteraciones', 'bundle.json');

async function isDir(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

function isInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Rutas relativas a la raíz del proyecto que `bundle` replica en la salida. */
export async function bundleTargets(cwd: string, config: SiteConfig): Promise<string[]> {
  const rels: string[] = [];
  if (await Bun.file(join(cwd, CONFIG_FILE)).exists()) rels.push(CONFIG_FILE);
  for (const dir of projectPreambleDirs()) {
    if (await isDir(join(cwd, dir))) rels.push(dir);
  }
  if (await isDir(join(cwd, FILTERS_DIR))) rels.push(FILTERS_DIR);
  const { bibFiles, bibOptions } = await resolveBibOptions(cwd, config);
  for (const abs of [...bibFiles, bibOptions?.csl ?? '']) {
    if (abs !== '' && isInside(cwd, abs)) rels.push(relative(cwd, abs));
  }
  return [...new Set(rels)].sort();
}

async function readManifest(cwd: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await Bun.file(join(cwd, MANIFEST)).text());
    return Array.isArray(parsed) ? parsed.filter((rel): rel is string => typeof rel === 'string') : [];
  } catch {
    return [];
  }
}

async function writeManifest(cwd: string, rels: string[]): Promise<void> {
  const path = join(cwd, MANIFEST);
  if (rels.length === 0) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(rels, null, 2)}\n`, 'utf8');
}

/** Copia (o retira) en `outputDir` lo que la config pide replicar. */
export async function writeBundle(cwd: string, outputDir: string, config: SiteConfig): Promise<string[]> {
  const prev = await readManifest(cwd);
  const next = config.bundle === true ? await bundleTargets(cwd, config) : [];
  const wanted = new Set(next);

  let removed = false;
  for (const rel of prev) {
    if (wanted.has(rel) || !isInside(outputDir, join(outputDir, rel))) continue;
    await rm(join(outputDir, rel), { recursive: true, force: true });
    removed = true;
  }
  if (next.length > 0) {
    await mkdir(outputDir, { recursive: true });
    for (const rel of next) {
      await cp(join(cwd, rel), join(outputDir, rel), { recursive: true, force: true, preserveTimestamps: true });
    }
  }
  if (removed) await pruneEmptyDirs(outputDir);
  await writeManifest(cwd, next);
  // El .sh repite la misma sincronía, pero solo si hay algo que sincronizar.
  if (prev.length > 0 || next.length > 0) {
    recordSupportCommand('resources', outputDir, ['iteraciones', 'bundle', '-o', outputDir]);
  }
  return next;
}
