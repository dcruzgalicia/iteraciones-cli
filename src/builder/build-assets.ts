import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { logWarning } from '../lib/logger.js';
import { run } from '../lib/run.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const CSS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
const FONTS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'fonts');

export async function buildAssets(outputDir: string, cwd: string, siteConfig: SiteConfig, options: { noCss?: boolean } = {}): Promise<string> {
  const tasks: Promise<void>[] = [copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)];
  if (!options.noCss) tasks.push(generateCss(outputDir, cwd, siteConfig.format?.html?.accent ?? 'lime'));
  await Promise.all(tasks);
  return options.noCss ? '' : '/css/styles.css';
}

async function generateCss(outputDir: string, cwd: string, accent: string): Promise<void> {
  const targetCssDir = join(outputDir, 'css');
  await mkdir(targetCssDir, { recursive: true });
  const targetCssPath = join(targetCssDir, 'styles.css');

  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const accentTheme = shades.map((s) => `  --color-accent-${s}: var(--color-${accent}-${s});`).join('\n');
  await buildCssWithTailwind(targetCssPath, cwd, accentTheme);
}

async function buildCssWithTailwind(targetCssPath: string, cwd: string, accentTheme: string): Promise<void> {
  const tempInputPath = join(tmpdir(), `_iteraciones-${crypto.randomUUID()}.css`);
  const tempContent = [
    `@import "${CSS_SRC}";`,
    `@source "${PKG_ROOT}";`,
    `@source "${PKG_ROOT}/src/lib/resources";`,
    `@source "${cwd}";`,
    `@theme {`,
    accentTheme,
    `}`,
  ].join('\n');
  await writeFile(tempInputPath, tempContent, 'utf8');
  try {
    const result = await run('bun', ['x', '--bun', '@tailwindcss/cli', '-i', tempInputPath, '-o', targetCssPath, '--minify']);
    if (result.exitCode !== 0) throw new Error(`Tailwind CSS falló:\n${result.stderr}`);
  } finally {
    await rm(tempInputPath, { force: true });
  }
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
        process.exitCode = 1;
      }
    });
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    logWarning(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`, 'assets');
    process.exitCode = 1;
    return;
  }
  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') logWarning(`logo no encontrado: "${logo}"`, 'assets');
    else {
      logWarning(`No se pudo copiar el logo "${logo}": ${err.message}`, 'assets');
      process.exitCode = 1;
    }
  });
}
