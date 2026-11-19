import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';
import { ACCENT_PALETTE_VALUES } from '../lib/accent-palette-values.js';
import { ACCENT_COLORS, ACCENT_SHADES, type AccentColor } from '../lib/accent-palettes.js';
import { BuildError } from '../lib/errors.js';
import { DEFAULT_HTML_STYLE, type HtmlStyle, htmlStyle, htmlStyleColor, STYLE_FONTS } from '../lib/html-styles.js';
import { logWarning } from '../lib/logger.js';
import { isDir } from '../lib/paths.js';
import { recordSupportCommand } from '../lib/script-recorder.js';
import { spawnMagick } from './image-processor.js';
import {
  ASSETS_CSS_FILE,
  ASSETS_FAVICON_PNG,
  ASSETS_FAVICON_SVG,
  ASSETS_FONTS_DIR,
  ASSETS_IMAGES_DIR,
  ASSETS_LOGO_SVG,
  ASSETS_LOGO_WEBP,
} from './output-layout.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const STYLES_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
const STYLES_DIR = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles');
const FONTS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'fonts');
const LICENSE_DIR = join(PKG_ROOT, 'src', 'lib', 'resources', 'license');
const LICENSE_ICONS = [
  { name: 'cc', file: 'cc.svg' },
  { name: 'by', file: 'by.svg' },
  { name: 'nc', file: 'nc.svg' },
  { name: 'nd', file: 'nd.svg' },
  { name: 'pf', file: 'pf.svg' },
  { name: 'ac', file: 'ac.svg' },
  { name: 'pr', file: 'pr.svg' },
  { name: 'fa', file: 'fa.svg' },
];
const ICONS_DIR = join(PKG_ROOT, 'src', 'lib', 'resources', 'icons');
const ICON_FILES = [
  { name: 'arrow-upward', size: 72 },
  { name: 'menu', size: 48 },
] as const;

async function fontFaceCss(style: HtmlStyle): Promise<string> {
  return STYLE_FONTS[style]
    .map(
      (font) =>
        `@font-face{font-family:"${font.family}";src:url(../fonts/${font.destination}) format("woff2");font-weight:${font.weight};font-display:fallback}`,
    )
    .join('');
}

function accentTokens(accent: AccentColor): string {
  const values = ACCENT_PALETTE_VALUES[accent];
  const tokens = ACCENT_SHADES.map((shade) => `--color-accent-${shade}:${values[shade]}`).join(';');
  return `:root{${tokens}}`;
}

export async function compileCss(
  outputDir: string,
  accent: string,
  style: string = DEFAULT_HTML_STYLE,
  theme: 'light' | 'dark' = 'light',
): Promise<void> {
  const estilo = htmlStyle(style);
  if (!ACCENT_COLORS.includes(accent as AccentColor)) throw new BuildError(`acento desconocido: "${accent}"`);
  const outPath = join(outputDir, ASSETS_CSS_FILE);
  const base = await readFile(STYLES_SRC, 'utf8');
  const styleCss = await readFile(join(STYLES_DIR, `${style}.css`), 'utf8');
  const darkCss = theme === 'dark' ? await readFile(join(STYLES_DIR, 'dark.css'), 'utf8') : '';
  const darkStyleCss = theme === 'dark' ? await readFile(join(STYLES_DIR, `dark-${style}.css`), 'utf8') : '';
  const inputDir = await mkdtemp(join(tmpdir(), 'iteraciones-css-'));
  try {
    const inputPath = join(inputDir, 'styles.css');
    await writeFile(inputPath, [accentTokens(accent as AccentColor), base, styleCss, darkCss, darkStyleCss].join('\n'), 'utf8');
    const result = await Bun.build({ entrypoints: [inputPath], minify: true });
    if (!result.success) throw new BuildError(`no se pudo compilar el CSS: ${result.logs.join('\n')}`);
    const output = result.outputs[0];
    if (output === undefined) throw new BuildError('no se pudo compilar el CSS: salida vacía');
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, (await fontFaceCss(estilo)) + (await output.text()).trim(), 'utf8');
  } finally {
    await rm(inputDir, { recursive: true, force: true });
  }
}

export async function computeCssHash(siteConfig: SiteConfig): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(await Bun.file(STYLES_SRC).text());
  const site = siteConfig.format?.html?.site;
  const style = htmlStyle(site?.style);
  const theme = site?.theme ?? 'light';
  const accent = htmlStyleColor(site?.style, site?.color) as AccentColor;
  hasher.update(style);
  hasher.update(theme);
  hasher.update(accent);
  hasher.update(await Bun.file(join(STYLES_DIR, `${style}.css`)).arrayBuffer());
  if (theme === 'dark') {
    hasher.update(await Bun.file(join(STYLES_DIR, 'dark.css')).arrayBuffer());
    hasher.update(await Bun.file(join(STYLES_DIR, `dark-${style}.css`)).arrayBuffer());
  }
  hasher.update(JSON.stringify(ACCENT_PALETTE_VALUES[accent]));
  hasher.update(JSON.stringify(STYLE_FONTS[style]));
  for (const font of STYLE_FONTS[style]) {
    hasher.update(await Bun.file(join(FONTS_SRC, font.source)).arrayBuffer());
  }
  return hasher.digest('hex');
}

export async function buildAssets(
  outputDir: string,
  cwd: string,
  siteConfig: SiteConfig,
  prevCssHash?: string,
  licenseIcons?: Set<string>,
): Promise<{ cssHash: string }> {
  await copyStaticAssets(outputDir, cwd, siteConfig, licenseIcons);
  const site = siteConfig.format?.html?.site;
  const style = htmlStyle(site?.style);
  const assetsArgv = ['iteraciones', 'assets', '-o', outputDir];
  if (licenseIcons !== undefined) assetsArgv.push('--licenses', [...licenseIcons].sort().join(','));
  recordSupportCommand('resources', outputDir, assetsArgv);
  const cssHash = await computeCssHash(siteConfig);
  const cssExists = await Bun.file(join(outputDir, ASSETS_CSS_FILE)).exists();
  if (prevCssHash !== cssHash || !cssExists) {
    const accent = htmlStyleColor(site?.style, site?.color);
    await compileCss(outputDir, accent, style, site?.theme ?? 'light');
  }
  return { cssHash };
}

const DEFAULT_LOGO = join(PKG_ROOT, 'src', 'lib', 'resources', 'logo.svg');

export type LogoAsset = { kind: 'file'; path: string; favicon?: string } | { kind: 'inline'; svg: string; favicon?: string };

function logoPx(size: string | undefined): number {
  const match = (size ?? '').trim().match(/^(\d+(?:\.\d+)?)px$/);
  return Math.round(Number(match?.[1] ?? Number.parseFloat(DEFAULT_HTML_FORMAT.site.logoSize)) * 2);
}

function accent500(color: string | undefined): string | undefined {
  const name = ACCENT_COLORS.includes(color as AccentColor) ? (color as AccentColor) : 'lime';
  const value = ACCENT_PALETTE_VALUES[name][500];
  return value === undefined ? undefined : (Bun.color(value, 'hex') ?? undefined);
}

async function colorCount(src: string): Promise<number> {
  const proc = Bun.spawn(['magick', src, '-resize', '64x64', '-alpha', 'off', '-format', '%k', 'info:'], { stdout: 'pipe', stderr: 'ignore' });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? Number.parseInt(out.trim(), 10) || 0 : 0;
}

async function writeSvgLogo(src: string, outputDir: string, accent: string | undefined): Promise<LogoAsset> {
  const svg = await readFile(src, 'utf8');
  const conAcento = accent === undefined ? svg : svg.replaceAll('currentColor', accent);
  const imagesDir = join(outputDir, ASSETS_IMAGES_DIR);
  await mkdir(imagesDir, { recursive: true });
  await writeFile(join(outputDir, ASSETS_LOGO_SVG), conAcento);
  await writeFile(join(outputDir, ASSETS_FAVICON_SVG), conAcento);
  await rm(join(outputDir, ASSETS_LOGO_WEBP), { force: true });
  await rm(join(outputDir, ASSETS_FAVICON_PNG), { force: true });
  return { kind: 'inline', svg, favicon: ASSETS_FAVICON_SVG };
}

async function writeRasterLogoOutputs(webpArgs: string[], faviconArgs: string[], outputDir: string): Promise<boolean> {
  if (!(await spawnMagick(webpArgs))) return false;
  await spawnMagick(faviconArgs);
  await rm(join(outputDir, ASSETS_LOGO_SVG), { force: true });
  await rm(join(outputDir, ASSETS_FAVICON_SVG), { force: true });
  return true;
}

async function rasterSvgLogo(src: string, outputDir: string, size: number, accent: string | undefined): Promise<boolean> {
  const rsvg = Bun.which('rsvg-convert');
  if (rsvg === null) return false;

  const webp = join(outputDir, ASSETS_LOGO_WEBP);
  const favicon = join(outputDir, ASSETS_FAVICON_PNG);
  await mkdir(dirname(webp), { recursive: true });

  const svg = await readFile(src, 'utf8');
  const conAcento = accent === undefined ? svg : svg.replaceAll('currentColor', accent);
  const tempDir = await mkdtemp(join(tmpdir(), 'iteraciones-logo-'));
  const svgPath = join(tempDir, 'logo.svg');
  const pngPath = join(tempDir, 'logo.png');
  await writeFile(svgPath, conAcento);

  try {
    const render = Bun.spawn([rsvg, '-w', String(size), '-h', String(size), '-o', pngPath, svgPath], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if ((await render.exited) !== 0) return false;
    return await writeRasterLogoOutputs(
      ['-background', 'none', pngPath, '-strip', '-define', 'webp:lossless=true', webp],
      ['-background', 'none', pngPath, '-resize', '32x32>', '-strip', favicon],
      outputDir,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function rasterLogo(src: string, outputDir: string, size: number, accent: string | undefined): Promise<boolean> {
  const webp = join(outputDir, ASSETS_LOGO_WEBP);
  await mkdir(dirname(webp), { recursive: true });
  await rm(join(outputDir, ASSETS_LOGO_SVG), { force: true });
  await rm(join(outputDir, ASSETS_FAVICON_SVG), { force: true });
  const isSvg = src.toLowerCase().endsWith('.svg');
  const svg = isSvg ? await readFile(src, 'utf8') : '';
  const soloCurrentColor = isSvg && svg.includes('currentColor') && !/#[0-9a-f]{3,8}\b/i.test(svg) && !/rgb\(/i.test(svg);

  let input = src;
  let tempDir: string | undefined;
  if (isSvg && accent !== undefined && svg.includes('currentColor') && !soloCurrentColor) {
    tempDir = await mkdtemp(join(tmpdir(), 'iteraciones-logo-'));
    input = join(tempDir, 'logo.svg');
    await writeFile(input, svg.replaceAll('currentColor', accent));
  }

  const colorize =
    accent !== undefined && (soloCurrentColor || (input === src && (await colorCount(src)) <= 2))
      ? ['-channel', 'RGB', '-fill', accent, '-colorize', '100', '+channel']
      : [];

  try {
    const base = ['-background', 'none', '-density', '300', '-units', 'PixelsPerInch', input];
    return await writeRasterLogoOutputs(
      [...base, '-resize', `${size}x>`, '-strip', '-define', 'webp:lossless=true', ...colorize, webp],
      [...base, '-resize', '32x32>', '-strip', ...colorize, join(outputDir, ASSETS_FAVICON_PNG)],
      outputDir,
    );
  } finally {
    if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
  }
}

export async function writeLogoAssets(cwd: string, outputDir: string, siteConfig: SiteConfig): Promise<LogoAsset | undefined> {
  const logo = siteConfig.format?.html?.site?.logo?.trim();
  const html = siteConfig.format?.html;
  const size = logoPx(html?.site?.logoSize);
  const accent = accent500(htmlStyleColor(html?.site?.style, html?.site?.color));

  if (!logo) {
    if (await rasterSvgLogo(DEFAULT_LOGO, outputDir, size, accent)) {
      return { kind: 'file', path: ASSETS_LOGO_WEBP, favicon: ASSETS_FAVICON_PNG };
    }
    return writeSvgLogo(DEFAULT_LOGO, outputDir, accent);
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    throw new BuildError(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`);
  }
  const src = join(cwd, logo);
  if (!(await Bun.file(src).exists())) {
    logWarning(`logo no encontrado: "${logo}"`, 'assets');
    return undefined;
  }
  if (src.toLowerCase().endsWith('.svg')) {
    if (await rasterSvgLogo(src, outputDir, size, accent)) {
      return { kind: 'file', path: ASSETS_LOGO_WEBP, favicon: ASSETS_FAVICON_PNG };
    }
    return writeSvgLogo(src, outputDir, accent);
  }
  if (await rasterLogo(src, outputDir, size, accent)) {
    return { kind: 'file', path: ASSETS_LOGO_WEBP, favicon: ASSETS_FAVICON_PNG };
  }
  logWarning(`no se pudo convertir el logo "${logo}" a WebP`, 'assets');
  return undefined;
}

export async function writeSiteBackground(cwd: string, outputDir: string, siteConfig: SiteConfig): Promise<string | undefined> {
  const raw = siteConfig.format?.html?.site?.backgroundImage?.trim();
  if (raw === undefined || raw === '') return undefined;
  if (raw.split('/').includes('..') || raw.startsWith('/')) {
    throw new BuildError(`backgroundImage: ruta inválida "${raw}" — debe ser relativa al proyecto`);
  }
  const src = join(cwd, raw);
  if (!(await Bun.file(src).exists())) {
    logWarning(`fondo no encontrado: "${raw}"`, 'assets');
    return undefined;
  }
  const dest = join(outputDir, ASSETS_IMAGES_DIR, 'site-background.webp');
  await mkdir(dirname(dest), { recursive: true });
  if (!(await spawnMagick([src, '-resize', '1920x>', '-strip', '-quality', '60', dest]))) {
    logWarning(`no se pudo convertir el fondo "${raw}" a WebP`, 'assets');
    return undefined;
  }
  return `${ASSETS_IMAGES_DIR}/site-background.webp`;
}

async function iconAWebp(src: string, dest: string, size: number, tint?: string): Promise<boolean> {
  await mkdir(dirname(dest), { recursive: true });
  const args = ['-background', 'none', src, '-resize', `${size}x${size}`, '-strip', '-define', 'webp:lossless=true'];
  if (tint !== undefined) args.push('-fuzz', '20%', '-fill', tint, '-opaque', 'black');
  args.push(dest);
  return spawnMagick(args);
}

async function writeIconAssets(outputDir: string, siteConfig: SiteConfig): Promise<void> {
  const site = siteConfig.format?.html?.site;
  const accent = accent500(htmlStyleColor(site?.style, site?.color));
  for (const icon of ICON_FILES) {
    const src = join(ICONS_DIR, `${icon.name}.svg`);
    const dest = join(outputDir, ASSETS_IMAGES_DIR, `${icon.name}.webp`);
    if (!(await iconAWebp(src, dest, icon.size, accent))) {
      throw new BuildError(`no se pudo convertir el icono "${icon.name}" a WebP`);
    }
  }
}

async function copyLicenseIcons(outputDir: string, licenseIcons?: Set<string>): Promise<void> {
  for (const icon of LICENSE_ICONS) {
    const src = join(LICENSE_DIR, icon.file);
    const dest = join(outputDir, ASSETS_IMAGES_DIR, `${icon.name}.webp`);
    if (licenseIcons !== undefined && !licenseIcons.has(icon.name)) {
      await rm(dest, { force: true });
      continue;
    }
    if (!(await iconAWebp(src, dest, 32))) {
      throw new BuildError(`no se pudo convertir el icono de licencia "${icon.name}" a WebP`);
    }
  }
}

async function copyFontAssets(outputDir: string, style: HtmlStyle): Promise<void> {
  const dest = join(outputDir, ASSETS_FONTS_DIR);
  await rm(dest, { recursive: true, force: true });
  const fonts = STYLE_FONTS[style];
  if (fonts.length === 0) return;
  await mkdir(dest, { recursive: true });
  for (const font of fonts) {
    await cp(join(FONTS_SRC, font.source), join(dest, font.destination));
    await cp(join(FONTS_SRC, font.license), join(dest, font.licenseDestination));
  }
}

export async function copyStaticAssets(outputDir: string, cwd: string, siteConfig: SiteConfig, licenseIcons?: Set<string>): Promise<void> {
  await writeLogoAssets(cwd, outputDir, siteConfig);
  await copyLicenseIcons(outputDir, licenseIcons);
  await writeIconAssets(outputDir, siteConfig);
  await copyFontAssets(outputDir, htmlStyle(siteConfig.format?.html?.site?.style));
}

export async function copyAdminSite(cwd: string, outputDir: string): Promise<void> {
  const src = join(cwd, 'admin');
  if (!(await isDir(src))) return;
  if (!(await Bun.file(join(src, 'index.html')).exists())) return;
  const dest = join(outputDir, 'admin');
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
}
