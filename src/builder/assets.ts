import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { run } from '../services/run.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const CSS_SRC = join(PKG_ROOT, 'css', 'styles.css');
const FONTS_SRC = join(PKG_ROOT, 'fonts');

export async function buildAssets(
  outputDir: string,
  cwd: string,
  siteConfig: SiteConfig,
  options: { noTailwind?: boolean; cssHash?: string } = {},
): Promise<string> {
  const tasks: Promise<void>[] = [copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)];
  if (!options.noTailwind) tasks.push(generateCss(outputDir, cwd, siteConfig.format?.html?.accent ?? 'lime', options.cssHash));
  await Promise.all(tasks);
  return options.noTailwind ? '' : '/css/styles.css';
}

async function generateCss(outputDir: string, cwd: string, accent: string, cssHash?: string): Promise<void> {
  const targetCssDir = join(outputDir, 'css');
  await mkdir(targetCssDir, { recursive: true });
  const targetCssPath = join(targetCssDir, 'styles.css');
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const accentTheme = shades.map((s) => `  --color-accent-${s}: var(--color-${accent}-${s});`).join('\n');

  if (cssHash) {
    const cssCachePath = join(cwd, '.iteraciones', '.css-hash');
    try {
      const previousHash = (await Bun.file(cssCachePath).text()).trim();
      if (previousHash === cssHash) {
        // Cache hit: copiar CSS anterior si existe
        const cachedCssPath = join(cwd, '.iteraciones', 'css', 'styles.css');
        const cached = await Bun.file(cachedCssPath).exists();
        if (cached) {
          await cp(cachedCssPath, targetCssPath);
          return;
        }
      }
    } catch {
      // No cache previa, regenerar
    }
  }

  const generated = await buildCssWithTailwind(targetCssPath, cwd, accentTheme);

  if (cssHash) {
    const cssCacheDir = join(cwd, '.iteraciones', 'css');
    await mkdir(cssCacheDir, { recursive: true });
    await Bun.write(join(cssCacheDir, 'styles.css'), generated);
    await Bun.write(join(cwd, '.iteraciones', '.css-hash'), cssHash + '\n');
  }
}

async function buildCssWithTailwind(targetCssPath: string, cwd: string, accentTheme: string): Promise<string> {
  const tempInputPath = join(tmpdir(), `_iteraciones-${crypto.randomUUID()}.css`);
  const tempContent = [
    `@import "${CSS_SRC}";`,
    `@source "${PKG_ROOT}";`,
    `@source "${PKG_ROOT}/themes";`,
    `@source "${cwd}";`,
    `@theme {`,
    accentTheme,
    `}`,
  ].join('\n');
  await writeFile(tempInputPath, tempContent, 'utf8');
  try {
    const result = await run('bun', ['x', '--bun', '@tailwindcss/cli', '-i', tempInputPath, '-o', targetCssPath, '--minify']);
    if (result.exitCode !== 0) {
      throw new Error(`Tailwind CSS falló:\n${result.stderr}`);
    }
  } finally {
    await rm(tempInputPath, { force: true });
  }
  return Bun.file(targetCssPath).text();
}

async function copyFonts(outputDir: string): Promise<void> {
  const target = join(outputDir, 'fonts');
  await cp(FONTS_SRC, target, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.logo?.trim();

  if (!logo) {
    // Sin logo configurado: usar el logo por defecto del paquete
    const defaultSrc = join(PKG_ROOT, 'themes', 'default', 'logo.svg');
    const dest = join(outputDir, 'logo.svg');
    await mkdir(dirname(dest), { recursive: true });
    await cp(defaultSrc, dest).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        process.stderr.write(`\r\x1b[K⚠ logo por defecto no encontrado en "${defaultSrc}"\n`);
      } else {
        process.stderr.write(`\n⚠ No se pudo copiar el logo por defecto: ${err.message}\n`);
        process.exitCode = 1;
      }
    });
    return;
  }

  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    process.stderr.write(`\n⚠ logo: ruta inválida "${logo}" — debe ser relativa al proyecto\n`);
    process.exitCode = 1;
    return;
  }

  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      process.stderr.write(`\r\x1b[K⚠ logo no encontrado: "${logo}"\n`);
    } else {
      process.stderr.write(`\n⚠ No se pudo copiar el logo "${logo}": ${err.message}\n`);
      process.exitCode = 1;
    }
  });
}
