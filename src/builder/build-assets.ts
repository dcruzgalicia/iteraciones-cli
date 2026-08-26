import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteConfig } from '../config/config-schema.js';
import { ACCENT_PALETTES, type AccentColor } from '../lib/accent-palettes.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { cacheHitFor } from './state-hash.js';
import type { CssFileCache } from './state-serialize.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const FONTS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'fonts');
/** Plantilla del CSS de entrada: fuentes, @plugin typography, @custom-variant dark y utilities custom. */
const STYLES_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
/** Fallback: node_modules local del paquete (caso bun link, repo clonado). */
const TAILWIND_BIN_DIRECT = join(PKG_ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/**
 * Resuelve la ruta del binario del CLI de Tailwind por el algoritmo de módulos
 * (sube por node_modules desde el código del paquete): robusto ante el
 * hoisting de npm/bun en instalaciones globales o como dependency de otro
 * proyecto. El paquete no expone entry principal (solo bin y
 * exports: ["./package.json"]), así que se resuelve su package.json y se
 * construye la ruta desde el campo bin.tailwindcss.
 */
export async function resolveTailwindBin(): Promise<string> {
  try {
    const pkgUrl = import.meta.resolve('@tailwindcss/cli/package.json');
    const pkgPath = fileURLToPath(pkgUrl);
    const pkg = JSON.parse(await Bun.file(pkgPath).text()) as { bin?: Record<string, string> | string };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tailwindcss;
    if (bin) {
      const resolved = join(dirname(pkgPath), bin);
      if (await Bun.file(resolved).exists()) return resolved;
    }
  } catch {
    // Resolución fallida: se prueba el fallback local
  }
  if (await Bun.file(TAILWIND_BIN_DIRECT).exists()) return TAILWIND_BIN_DIRECT;
  throw new BuildError(`no se encontró el binario de Tailwind CSS (@tailwindcss/cli). Verifica que el paquete esté instalado (bun install).`);
}

/**
 * Compila el CSS final con Tailwind escaneando SOLO los HTML de `outputDir`
 * (dist/files). El input es un archivo efímero en tmpdir con:
 *   - `@import` absoluto a styles.css (fuentes, plugin typography, utilities custom).
 *   - `@source` absoluto a outputDir con patrón html: ni el CSS previo, ni los
 *     .md, ni archivos fuera de dist/files aportan clases (purga exacta, sin
 *     auto-referencia).
 *   - `@theme` con los valores directos de la paleta del acento configurado:
 *     las utilities accent-* se generan con el color real, sin overrides.
 * El proceso corre con cwd = directorio del input: el auto-detection de
 * Tailwind solo ve el input.css (que el scanner ignora) y las únicas fuentes
 * son las del @source explícito. Sin caché: se ejecuta en cada build con HTML
 * activo.
 */
export async function compileTailwindCss(outputDir: string, accent: string): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'iteraciones-css-'));
  const inputPath = join(tempDir, 'input.css');
  const palette = ACCENT_PALETTES[accent as AccentColor];
  if (palette === undefined) throw new BuildError(`acento desconocido: "${accent}"`);
  const accentTheme = SHADES.map((s) => `  --color-accent-${s}: ${palette[s as keyof typeof palette]};`).join('\n');
  const input = [`@import "${STYLES_SRC}";`, `@source "${outputDir}/**/*.html";`, '@theme {', accentTheme, '}'].join('\n');

  await writeFile(inputPath, input, 'utf8');
  await mkdir(join(outputDir, 'css'), { recursive: true });
  try {
    const tailwindBin = await resolveTailwindBin();
    // cwd = directorio del input (no dist/files): el auto-detection de Tailwind
    // escanea el cwd y vería los .md/css de dist/files, contaminando el scan.
    // La garantía de "solo dist/files" la da el @source explícito a *.html.
    const proc = Bun.spawn([process.execPath, tailwindBin, '-i', inputPath, '-o', join(outputDir, 'css', 'styles.css'), '--minify'], {
      cwd: tempDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) {
      throw new BuildError(`Tailwind CSS falló al compilar el CSS:\n${stderr || stdout}`);
    }
  } catch (err) {
    if (err instanceof BuildError) throw err;
    throw new BuildError(`no se pudo ejecutar Tailwind CSS. Verifica que el paquete esté instalado (bun install).`);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Hash de invalidación del CSS: contenido de los HTML finales de dist/files
 * (las clases que Tailwind debe incluir/purgar) + CSS base + paleta del acento
 * + binario de Tailwind (mtime+size). Si nada cambió, el CSS no se recompila.
 *
 * La caché por archivo (mtime+size+hash) evita releer el contenido de los
 * HTML sin cambios (mismo patrón content-addressed de discover): con mtime y
 * size intactos se reutiliza el hash; si solo cambió el mtime (touch), se
 * relee y se hashea para decidir (caso ambiguo); si cambió el size, se relee.
 */
export async function computeCssHash(
  outputDir: string,
  siteConfig: SiteConfig,
  prevCache?: CssFileCache,
): Promise<{ hash: string; cache: CssFileCache }> {
  const hasher = new Bun.CryptoHasher('sha256');
  const cache: CssFileCache = {};
  // HTML finales: orden determinista (paths relativos ordenados).
  // Sin directorio de salida (proyecto vacío) no hay HTMLs: hash base.
  const htmlPaths: string[] = [];
  const outputIsDir = await Bun.file(outputDir)
    .stat()
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (outputIsDir) {
    for await (const entry of new Bun.Glob('**/*.html').scan({ cwd: outputDir, onlyFiles: true })) {
      htmlPaths.push(entry);
    }
  }
  htmlPaths.sort();
  for (const rel of htmlPaths) {
    const st = await Bun.file(join(outputDir, rel)).stat();
    const mtime = Math.round(st.mtimeMs);
    const size = st.size;
    const prev = prevCache?.[rel];
    let contentHash: string;
    // Decisión única de caché (#2020): sin cambios ⇒ reutilizar el hash sin
    // releer el contenido
    const hit = cacheHitFor(prev, mtime, size);
    if (hit !== null) {
      contentHash = hit;
    } else {
      // Cambiado (o ambiguo: mtime distinto con size igual): releer y hashear
      const bytes = new Uint8Array(await Bun.file(join(outputDir, rel)).arrayBuffer());
      contentHash = Bun.CryptoHasher.hash('sha256', bytes, 'hex');
    }
    cache[rel] = { mtime, size, hash: contentHash };
    hasher.update(rel);
    hasher.update(contentHash);
  }
  // CSS base + paleta del acento configurado
  const stylesSrc = await Bun.file(STYLES_SRC).text();
  hasher.update(stylesSrc);
  const accent = siteConfig.format?.html?.site?.color ?? 'lime';
  hasher.update(JSON.stringify(ACCENT_PALETTES[accent as AccentColor] ?? {}));
  // El binario de Tailwind (mtime+size, patrón content-addressed del proyecto):
  // una actualización del paquete debe invalidar el CSS cacheado, aunque los
  // HTML no hayan cambiado.
  const tailwindBin = await resolveTailwindBin().catch(() => '');
  if (tailwindBin) {
    const binStat = await Bun.file(tailwindBin)
      .stat()
      .catch(() => null);
    if (binStat) {
      hasher.update('tailwind-bin');
      hasher.update(String(Math.round(binStat.mtimeMs)));
      hasher.update(String(binStat.size));
    }
  }
  return { hash: hasher.digest('hex'), cache };
}

/**
 * Genera los assets (fuentes, logo y CSS). Retorna el hash de invalidación
 * del CSS y la caché por archivo que lo produjo ('' si el CSS no se compiló).
 * Si `prevCssHash` coincide con el hash actual y el CSS ya existe, la
 * compilación de Tailwind se omite.
 */
export async function buildAssets(
  outputDir: string,
  cwd: string,
  siteConfig: SiteConfig,
  prevCssHash?: string,
  prevCssFileCache?: CssFileCache,
): Promise<{ cssHash: string; cssFileCache: CssFileCache }> {
  const tasks: Promise<void>[] = [copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)];
  const { hash: cssHash, cache: cssFileCache } = await computeCssHash(outputDir, siteConfig, prevCssFileCache);
  const cssExists = await Bun.file(join(outputDir, 'css', 'styles.css')).exists();
  if (prevCssHash !== cssHash || !cssExists) {
    const accent = siteConfig.format?.html?.site?.color ?? 'lime';
    tasks.push(compileTailwindCss(outputDir, accent));
  }
  await Promise.all(tasks);
  return { cssHash, cssFileCache };
}

/**
 * Copia un archivo solo si el destino no existe o su mtime/size difieren del
 * origen (mismo patrón content-addressed del resto del pipeline: nada se
 * escribe sin necesidad). La copia preserva el mtime del origen
 * (preserveTimestamps; el cp de Bun lo trunca a milisegundos enteros, por eso
 * la comparación usa floor) y sobrescribe el destino (force: Bun no sobrescribe
 * por defecto, a diferencia de Node).
 */
async function copyIfChanged(src: string, dest: string): Promise<void> {
  let srcStat: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    srcStat = await stat(src);
  } catch {
    // Origen ilegible: se deja que cp reporte el error real en el call site
  }
  if (srcStat !== null) {
    const destStat = await stat(dest).catch(() => null);
    if (destStat !== null && destStat.size === srcStat.size && Math.floor(destStat.mtimeMs) === Math.floor(srcStat.mtimeMs)) {
      return;
    }
  }
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { force: true, preserveTimestamps: true });
}

async function copyFonts(outputDir: string): Promise<void> {
  const target = join(outputDir, 'fonts');
  let entries: string[];
  try {
    // Fuentes (.ttf) y sus licencias OFL (OFL-*.txt): las licencias SIL Open
    // Font acompañan a las fuentes al redistribuirlas (la salida dist/ se
    // publica tal cual). Mismo patrón de copia condicional (mtime/size).
    entries = [
      ...[...new Bun.Glob('*.ttf').scanSync({ cwd: FONTS_SRC, onlyFiles: true })],
      ...[...new Bun.Glob('OFL-*.txt').scanSync({ cwd: FONTS_SRC, onlyFiles: true })],
    ].sort();
  } catch (err) {
    // Directorio de fuentes ausente: nada que copiar (mismo criterio que el cp anterior)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  await mapWithConcurrency(entries, 8, async (entry) => {
    await copyIfChanged(join(FONTS_SRC, entry), join(target, entry));
  });
}

async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.format?.html?.site?.logo?.trim();
  if (!logo) {
    const defaultSrc = join(PKG_ROOT, 'src', 'lib', 'resources', 'logo.svg');
    const dest = join(outputDir, 'logo.svg');
    try {
      await copyIfChanged(defaultSrc, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') logWarning(`logo por defecto no encontrado en "${defaultSrc}"`, 'assets');
      else {
        // El dispatcher ya reporta el error lanzado: sin logWarning duplicado (#2081).
        throw new BuildError(`No se pudo copiar el logo por defecto: ${(err as Error).message}`);
      }
    }
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    throw new BuildError(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`);
  }
  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  try {
    await copyIfChanged(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') logWarning(`logo no encontrado: "${logo}"`, 'assets');
    else {
      // El dispatcher ya reporta el error lanzado: sin logWarning duplicado (#2081).
      throw new BuildError(`No se pudo copiar el logo "${logo}": ${(err as Error).message}`);
    }
  }
}
