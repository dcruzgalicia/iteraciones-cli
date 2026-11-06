import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';
import { ACCENT_COLORS, ACCENT_SHADES, type AccentColor } from '../lib/accent-palettes.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { isDir } from '../lib/paths.js';
import { recordSupportCommand } from '../lib/script-recorder.js';
import { ASSETS_CSS_FILE, ASSETS_FAVICON_PNG, ASSETS_IMAGES_DIR, ASSETS_LOGO_WEBP } from './output-layout.js';
import { hashGlobbedFiles } from './state-hash.js';
import type { CssFileCache } from './state-serialize.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const STYLES_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
const LICENSE_DIR = join(PKG_ROOT, 'src', 'lib', 'resources', 'license');
const LICENSE_ICONS = [
  { name: 'cc', file: 'cc.svg' },
  { name: 'by', file: 'by.svg' },
  { name: 'nc', file: 'nc.svg' },
  { name: 'nd', file: 'nd.svg' },
  { name: 'pf', file: 'pf.svg' },
  { name: 'pr', file: 'pr.svg' },
  { name: 'f2f-atribucion', file: 'f2f-atribucion.png' },
  { name: 'f2f-compartirigual', file: 'f2f-compartirigual.png' },
  { name: 'f2f-feministanocapitalista', file: 'f2f-feministanocapitalista.png' },
];
const ICONS_DIR = join(PKG_ROOT, 'src', 'lib', 'resources', 'icons');
const ICON_FILES = [
  { name: 'arrow-upward', size: 32 },
  { name: 'menu', size: 16 },
] as const;

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

const DEFAULT_LOGO = join(PKG_ROOT, 'src', 'lib', 'resources', 'logo.svg');

/** Cómo se muestra el logo del sitio en el HTML. */
export type LogoAsset =
  /** Va incrustado en el HTML: el SVG de fábrica o un raster sin ImageMagick. */
  | { kind: 'inline'; html: string; favicon?: string }
  /** Vive en `assets/`: el HTML lo referencia y el navegador lo cachea. */
  | { kind: 'file'; path: string; favicon?: string };

/** El ancho en píxeles del logo: el doble del tamaño CSS, para pantallas 2×. */
function logoPx(size: string | undefined): number {
  const match = (size ?? '').trim().match(/^(\d+(?:\.\d+)?)px$/);
  return Math.round(Number(match?.[1] ?? Number.parseFloat(DEFAULT_HTML_FORMAT.site.logoSize)) * 2);
}

async function runMagick(args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(['magick', ...args], { stdout: 'ignore', stderr: 'ignore' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/**
 * Convierte un `oklch()` de Tailwind a `#rrggbb`. ImageMagick no interpreta
 * bien el oklch —ni el porcentaje ni el `-fill`—, así que la cuenta se hace
 * aquí. El resultado es sRGB, apenas más apagado que el color en pantalla.
 */
function oklchToHex(value: string): string | undefined {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(?:\s+([\d.]+))?\s*\)/.exec(value.trim());
  if (match === null) return undefined;
  const L = Number(match[1]) / (match[2] === '%' ? 100 : 1);
  const chroma = Number(match[3]);
  const hue = (Number(match[4] ?? '0') * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const hex = linear
    .map((x) => {
      const gamma = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, gamma)) * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
  return `#${hex}`;
}

/** El accent-500 del tema, en hex. */
async function accent500(color: string | undefined): Promise<string | undefined> {
  try {
    const css = await Bun.file(fileURLToPath(import.meta.resolve('tailwindcss/theme.css'))).text();
    const raw = new RegExp(`--color-${color ?? 'lime'}-500:\\s*([^;]+);`).exec(css)?.[1]?.trim();
    return raw === undefined ? undefined : oklchToHex(raw);
  } catch {
    return undefined;
  }
}

/** Cuenta los colores de una muestra: un logo plano se puede teñir. */
async function colorCount(src: string): Promise<number> {
  const proc = Bun.spawn(['magick', src, '-resize', '64x64', '-alpha', 'off', '-format', '%k', 'info:'], { stdout: 'pipe', stderr: 'ignore' });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? Number.parseInt(out.trim(), 10) || 0 : 0;
}

/**
 * Deja el logo raster en `assets/images/logo.webp`, al doble del tamaño CSS y sin
 * pérdida, con su favicon PNG de 32 px. Un logo de uno o dos colores se tiñe
 * con el accent del tema; uno a color conserva los suyos.
 */
async function rasterLogo(src: string, outputDir: string, size: number, accent: string | undefined): Promise<boolean> {
  const webp = join(outputDir, ASSETS_LOGO_WEBP);
  await mkdir(dirname(webp), { recursive: true });
  const args = [src, '-resize', `${size}x>`, '-strip', '-define', 'webp:lossless=true'];
  // ponytail: cuenta colores sobre una muestra de 64 px; un logo con antialias
  // o degradados nunca baja de 2 y se queda con sus colores, que es lo seguro.
  if (accent !== undefined && (await colorCount(src)) <= 2) args.push('-fill', accent, '-colorize', '100');
  args.push(webp);
  if (!(await runMagick(args))) return false;
  await runMagick([src, '-resize', '32x32>', '-strip', join(outputDir, ASSETS_FAVICON_PNG)]);
  return true;
}

/**
 * Resuelve el logo del sitio y lo deja en `assets/images/logo.webp`.
 * El SVG de fábrica también se rasteriza: el HTML no lleva SVG incrustado.
 */
export async function writeLogoAssets(cwd: string, outputDir: string, siteConfig: SiteConfig): Promise<LogoAsset | undefined> {
  const logo = siteConfig.format?.html?.site?.logo?.trim();
  const html = siteConfig.format?.html;
  const size = logoPx(html?.site?.logoSize);
  const accent = await accent500(html?.site?.color);

  if (!logo) {
    if (await rasterLogo(DEFAULT_LOGO, outputDir, size, accent)) {
      return { kind: 'file', path: ASSETS_LOGO_WEBP, favicon: ASSETS_FAVICON_PNG };
    }
    logWarning('no se pudo convertir el logo de fábrica a WebP', 'assets');
    return undefined;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    throw new BuildError(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`);
  }
  const src = join(cwd, logo);
  if (!(await Bun.file(src).exists())) {
    logWarning(`logo no encontrado: "${logo}"`, 'assets');
    return undefined;
  }
  if (await rasterLogo(src, outputDir, size, accent)) {
    return { kind: 'file', path: ASSETS_LOGO_WEBP, favicon: ASSETS_FAVICON_PNG };
  }
  logWarning(`no se pudo convertir el logo "${logo}" a WebP`, 'assets');
  return undefined;
}

/** Convierte un SVG a WebP con el tamaño indicado, conservando la transparencia. */
async function iconAWebp(src: string, dest: string, size: number, tint?: string): Promise<boolean> {
  await mkdir(dirname(dest), { recursive: true });
  const args = ['-background', 'none', src, '-resize', `${size}x${size}`, '-strip', '-define', 'webp:lossless=true'];
  if (tint !== undefined) args.push('-fuzz', '20%', '-fill', tint, '-opaque', 'black');
  args.push(dest);
  return runMagick(args);
}

/** Genera los iconos de interfaz como WebP, sin SVG dentro del HTML. */
async function writeIconAssets(outputDir: string, siteConfig: SiteConfig): Promise<void> {
  const accent = await accent500(siteConfig.format?.html?.site?.color);
  for (const icon of ICON_FILES) {
    const src = join(ICONS_DIR, `${icon.name}.svg`);
    const dest = join(outputDir, ASSETS_IMAGES_DIR, `${icon.name}.webp`);
    if (!(await iconAWebp(src, dest, icon.size, accent))) {
      throw new BuildError(`no se pudo convertir el icono "${icon.name}" a WebP`);
    }
  }
}

/** Convierte los iconos de las licencias a WebP de 32 px. */
async function copyLicenseIcons(outputDir: string): Promise<void> {
  for (const icon of LICENSE_ICONS) {
    const src = join(LICENSE_DIR, icon.file);
    const dest = join(outputDir, ASSETS_IMAGES_DIR, `${icon.name}.webp`);
    if (!(await iconAWebp(src, dest, 32))) {
      throw new BuildError(`no se pudo convertir el icono de licencia "${icon.name}" a WebP`);
    }
  }
}

export async function copyStaticAssets(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  await writeLogoAssets(cwd, outputDir, siteConfig);
  await copyLicenseIcons(outputDir);
  await writeIconAssets(outputDir, siteConfig);
}
