import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { ACCENT_PALETTES, type AccentColor, accentOverrideBlock } from '../lib/accent-palettes.js';
import { logWarning } from '../lib/logger.js';
import { hashString } from './state.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const FONTS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'fonts');
const CSS_BASE = join(PKG_ROOT, 'src', 'lib', 'resources', 'css', 'base.css');

/**
 * Hash de los inputs del CSS (acento + base.css, el archivo que el build
 * realmente consume: styles.css es solo la fuente Tailwind de scripts/).
 * Si no cambió respecto al build anterior y ningún documento fue modificado,
 * el CSS generado es idéntico y se reutiliza sin ensamblarlo de nuevo.
 */
export async function computeCssInputHash(siteConfig: SiteConfig): Promise<string> {
  const accent = siteConfig.format?.html?.accent ?? 'lime';
  const base = await Bun.file(CSS_BASE)
    .text()
    .catch(() => '');
  return hashString(`${accent}\n${base}`);
}

export async function buildAssets(outputDir: string, cwd: string, siteConfig: SiteConfig, options: { noCss?: boolean } = {}): Promise<string> {
  const tasks: Promise<void>[] = [copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)];
  if (!options.noCss) {
    const accent = siteConfig.format?.html?.accent ?? 'lime';
    tasks.push(assembleAccentCss(outputDir, accent));
  }
  await Promise.all(tasks);
  return options.noCss ? '' : '/css/styles.css';
}

/**
 * Ensambla el CSS del acento: el CSS base embarcado (placeholder lime) más un
 * bloque final con las variables de la paleta del acento. Las variables sin
 * capa ganan a las de @layer theme, así que el render es idéntico al que
 * Tailwind generaría compilando directamente con ese acento.
 */
async function assembleAccentCss(outputDir: string, accent: string): Promise<void> {
  const targetCssDir = join(outputDir, 'css');
  await mkdir(targetCssDir, { recursive: true });
  const palette = ACCENT_PALETTES[accent as AccentColor];
  if (palette === undefined) throw new Error(`acento desconocido: "${accent}"`);
  const base = await Bun.file(CSS_BASE).text();
  await Bun.write(join(targetCssDir, 'styles.css'), `${base}\n${accentOverrideBlock(accent as AccentColor)}`);
}

async function copyFonts(outputDir: string): Promise<void> {
  const target = join(outputDir, 'fonts');
  await cp(FONTS_SRC, target, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.format?.html?.logo?.trim();
  if (!logo) {
    const defaultSrc = join(PKG_ROOT, 'src', 'lib', 'resources', 'logo.svg');
    const dest = join(outputDir, 'logo.svg');
    await mkdir(dirname(dest), { recursive: true });
    await cp(defaultSrc, dest).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') logWarning(`logo por defecto no encontrado en "${defaultSrc}"`, 'assets');
      else {
        logWarning(`No se pudo copiar el logo por defecto: ${err.message}`, 'assets');
        throw new Error(`No se pudo copiar el logo por defecto: ${err.message}`);
      }
    });
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    throw new Error(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`);
  }
  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') logWarning(`logo no encontrado: "${logo}"`, 'assets');
    else {
      logWarning(`No se pudo copiar el logo "${logo}": ${err.message}`, 'assets');
      throw new Error(`No se pudo copiar el logo "${logo}": ${err.message}`);
    }
  });
}
