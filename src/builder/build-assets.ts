import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteConfig } from '../config/config-schema.js';
import { ACCENT_PALETTES, type AccentColor } from '../lib/accent-palettes.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { recordSupportCommand } from '../lib/script-recorder.js';
import { ASSETS_CSS_FILE, ASSETS_FONTS_DIR, ASSETS_LOGO_FILE } from './output-layout.js';
import { cacheHitFor } from './state-hash.js';
import type { CssFileCache } from './state-serialize.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const FONTS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'fonts');
const STYLES_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
const TAILWIND_BIN_DIRECT = join(PKG_ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

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
  } catch {}
  if (await Bun.file(TAILWIND_BIN_DIRECT).exists()) return TAILWIND_BIN_DIRECT;
  throw new BuildError(`no se encontró el binario de Tailwind CSS (@tailwindcss/cli). Verifica que el paquete esté instalado (bun install).`);
}

/**
 * Compila el CSS de salida. El `input.css` vive en `.iteraciones/css/` (no en un
 * temp) para que el `build.sh` pueda repetir exactamente esta fase por separado.
 */
export async function compileTailwindCss(outputDir: string, accent: string, projectRoot: string): Promise<void> {
  const inputDir = join(projectRoot, '.iteraciones', 'css');
  const inputPath = join(inputDir, 'input.css');
  const outPath = join(outputDir, ASSETS_CSS_FILE);
  const palette = ACCENT_PALETTES[accent as AccentColor];
  if (palette === undefined) throw new BuildError(`acento desconocido: "${accent}"`);
  const accentTheme = SHADES.map((s) => `  --color-accent-${s}: ${palette[s as keyof typeof palette]};`).join('\n');
  const input = [`@import "${STYLES_SRC}";`, `@source "${outputDir}/**/*.html";`, '@theme {', accentTheme, '}'].join('\n');

  await mkdir(inputDir, { recursive: true });
  await writeFile(inputPath, input, 'utf8');
  await mkdir(dirname(outPath), { recursive: true });
  try {
    const tailwindBin = await resolveTailwindBin();
    const argv = [process.execPath, tailwindBin, '-i', inputPath, '-o', outPath, '--minify'];
    const proc = Bun.spawn(argv, {
      cwd: inputDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) {
      throw new BuildError(`Tailwind CSS falló al compilar el CSS:\n${stderr || stdout}`);
    }
    // Tailwind auto-detecta fuentes desde el cwd: hay que grabarlo, o el .sh
    // reescanearía el proyecto entero (p. ej. .iteraciones/templates/*.html).
    recordSupportCommand('css', outputDir, argv, inputDir);
  } catch (err) {
    if (err instanceof BuildError) throw err;
    throw new BuildError(`no se pudo ejecutar Tailwind CSS. Verifica que el paquete esté instalado (bun install).`);
  }
}

export async function computeCssHash(
  outputDir: string,
  siteConfig: SiteConfig,
  prevCache?: CssFileCache,
): Promise<{ hash: string; cache: CssFileCache }> {
  const hasher = new Bun.CryptoHasher('sha256');
  const cache: CssFileCache = {};
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
    const hit = cacheHitFor(prev, mtime, size);
    if (hit !== null) {
      contentHash = hit;
    } else {
      const bytes = new Uint8Array(await Bun.file(join(outputDir, rel)).arrayBuffer());
      contentHash = Bun.CryptoHasher.hash('sha256', bytes, 'hex');
    }
    cache[rel] = { mtime, size, hash: contentHash };
    hasher.update(rel);
    hasher.update(contentHash);
  }
  const stylesSrc = await Bun.file(STYLES_SRC).text();
  hasher.update(stylesSrc);
  const accent = siteConfig.format?.html?.site?.color ?? 'lime';
  hasher.update(JSON.stringify(ACCENT_PALETTES[accent as AccentColor] ?? {}));
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
 * Los dos ficheros estáticos que el HTML referencia: las fuentes del paquete y
 * el logo (el de la config, o el por defecto). El build y `iteraciones assets`
 * pasan por aquí, así que el .sh copia exactamente lo que copió TypeScript.
 */
export async function copyStaticAssets(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  await Promise.all([copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)]);
}

export async function buildAssets(
  outputDir: string,
  cwd: string,
  siteConfig: SiteConfig,
  prevCssHash?: string,
  prevCssFileCache?: CssFileCache,
): Promise<{ cssHash: string; cssFileCache: CssFileCache }> {
  await copyStaticAssets(outputDir, cwd, siteConfig);
  recordSupportCommand('resources', outputDir, ['iteraciones', 'assets', '-o', outputDir]);
  const { hash: cssHash, cache: cssFileCache } = await computeCssHash(outputDir, siteConfig, prevCssFileCache);
  const cssExists = await Bun.file(join(outputDir, ASSETS_CSS_FILE)).exists();
  if (prevCssHash !== cssHash || !cssExists) {
    const accent = siteConfig.format?.html?.site?.color ?? 'lime';
    await compileTailwindCss(outputDir, accent, cwd);
  }
  return { cssHash, cssFileCache };
}

async function copyIfChanged(src: string, dest: string): Promise<void> {
  let srcStat: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    srcStat = await stat(src);
  } catch {}
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
  const target = join(outputDir, ASSETS_FONTS_DIR);
  let entries: string[];
  try {
    entries = [
      ...[...new Bun.Glob('*.ttf').scanSync({ cwd: FONTS_SRC, onlyFiles: true })],
      ...[...new Bun.Glob('OFL-*.txt').scanSync({ cwd: FONTS_SRC, onlyFiles: true })],
    ].sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  await mapWithConcurrency(entries, 8, async (entry) => {
    await copyIfChanged(join(FONTS_SRC, entry), join(target, entry));
  });
}

async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.format?.html?.site?.logo?.trim();
  // #2450: el logo de dist vive en `assets/` con nombre fijo, venga de donde
  // venga; el HTML no lo referencia (lo lleva inline), es material de la réplica.
  const dest = join(outputDir, ASSETS_LOGO_FILE);
  if (!logo) {
    const defaultSrc = join(PKG_ROOT, 'src', 'lib', 'resources', 'logo.svg');
    try {
      await copyIfChanged(defaultSrc, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') logWarning(`logo por defecto no encontrado en "${defaultSrc}"`, 'assets');
      else {
        throw new BuildError(`No se pudo copiar el logo por defecto: ${(err as Error).message}`);
      }
    }
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    throw new BuildError(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`);
  }
  const src = join(cwd, logo);
  try {
    await copyIfChanged(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') logWarning(`logo no encontrado: "${logo}"`, 'assets');
    else {
      throw new BuildError(`No se pudo copiar el logo "${logo}": ${(err as Error).message}`);
    }
  }
}
