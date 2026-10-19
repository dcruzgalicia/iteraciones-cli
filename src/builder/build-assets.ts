import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteConfig } from '../config/config-schema.js';
import { ACCENT_COLORS, ACCENT_SHADES, type AccentColor } from '../lib/accent-palettes.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { isDir } from '../lib/paths.js';
import { recordSupportCommand } from '../lib/script-recorder.js';
import { ASSETS_CSS_FILE, ASSETS_LOGO_FILE } from './output-layout.js';
import { hashGlobbedFiles } from './state-hash.js';
import type { CssFileCache } from './state-serialize.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const STYLES_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');

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
  throw new BuildError(`no se encontró el binario de Tailwind CSS (@tailwindcss/cli). Verifica que el paquete esté instalado (bun install).`);
}

export async function compileTailwindCss(outputDir: string, accent: string, projectRoot: string): Promise<void> {
  const inputDir = join(projectRoot, '.iteraciones', 'css');
  const inputPath = join(inputDir, 'input.css');
  const outPath = join(outputDir, ASSETS_CSS_FILE);
  if (!ACCENT_COLORS.includes(accent as AccentColor)) throw new BuildError(`acento desconocido: "${accent}"`);
  const accentTheme = ACCENT_SHADES.map((s) => `  --color-accent-${s}: var(--color-${accent}-${s});`).join('\n');
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
  if (await isDir(outputDir)) {
    for (const part of await hashGlobbedFiles(outputDir, '**/*.html', prevCache, cache)) hasher.update(part);
  }
  const stylesSrc = await Bun.file(STYLES_SRC).text();
  hasher.update(stylesSrc);
  const accent = siteConfig.format?.html?.site?.color ?? 'lime';
  hasher.update(accent);
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

async function copyLogo(src: string, dest: string, missing: string, failedPrefix: string): Promise<void> {
  try {
    await copyIfChanged(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') logWarning(missing, 'assets');
    else {
      throw new BuildError(`${failedPrefix}: ${(err as Error).message}`);
    }
  }
}

export async function copyStaticAssets(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.format?.html?.site?.logo?.trim();

  const dest = join(outputDir, ASSETS_LOGO_FILE);
  if (!logo) {
    const defaultSrc = join(PKG_ROOT, 'src', 'lib', 'resources', 'logo.svg');
    await copyLogo(defaultSrc, dest, `logo por defecto no encontrado en "${defaultSrc}"`, 'No se pudo copiar el logo por defecto');
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    throw new BuildError(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`);
  }
  await copyLogo(join(cwd, logo), dest, `logo no encontrado: "${logo}"`, `No se pudo copiar el logo "${logo}"`);
}
