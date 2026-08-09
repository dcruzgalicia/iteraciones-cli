import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { ACCENT_PALETTES, type AccentColor } from '../lib/accent-palettes.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const FONTS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'fonts');
/** Plantilla del CSS de entrada: fuentes, @plugin typography, @custom-variant dark y utilities custom. */
const STYLES_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
/** Binario local del CLI de Tailwind (dependency del paquete). */
const TAILWIND_BIN = join(PKG_ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

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
    // cwd = directorio del input (no dist/files): el auto-detection de Tailwind
    // escanea el cwd y vería los .md/css de dist/files, contaminando el scan.
    // La garantía de "solo dist/files" la da el @source explícito a *.html.
    const proc = Bun.spawn([process.execPath, TAILWIND_BIN, '-i', inputPath, '-o', join(outputDir, 'css', 'styles.css'), '--minify'], {
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
    throw new BuildError(`no se pudo ejecutar Tailwind CSS (${TAILWIND_BIN}). Verifica que el paquete esté instalado (bun install).`);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function buildAssets(outputDir: string, cwd: string, siteConfig: SiteConfig, options: { noCss?: boolean } = {}): Promise<string> {
  const tasks: Promise<void>[] = [copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)];
  if (!options.noCss) {
    const accent = siteConfig.format?.html?.accent ?? 'lime';
    tasks.push(compileTailwindCss(outputDir, accent));
  }
  await Promise.all(tasks);
  return options.noCss ? '' : '/css/styles.css';
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
        throw new BuildError(`No se pudo copiar el logo por defecto: ${err.message}`);
      }
    });
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    throw new BuildError(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`);
  }
  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') logWarning(`logo no encontrado: "${logo}"`, 'assets');
    else {
      logWarning(`No se pudo copiar el logo "${logo}": ${err.message}`, 'assets');
      throw new BuildError(`No se pudo copiar el logo "${logo}": ${err.message}`);
    }
  });
}
