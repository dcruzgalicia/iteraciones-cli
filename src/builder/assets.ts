import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { run } from '../services/run.js';

const PKG_ROOT = join(import.meta.dir, '../..');
const CSS_SRC = join(PKG_ROOT, 'css', 'styles.css');
const FONTS_SRC = join(PKG_ROOT, 'fonts');

/**
 * Genera el CSS con Tailwind y copia fonts y logo al directorio de salida.
 * Retorna la ruta relativa del CSS generado para usar en el contexto del sitio.
 *
 * Precondición: outputDir ya existe y está limpio (limpieza a cargo del orchestrator).
 */
export async function buildAssets(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<string> {
  await Promise.all([generateCss(outputDir, cwd), copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)]);
  // Ruta absoluta desde la raíz del sitio para que funcione en páginas anidadas
  // (p.ej. posts/a.html necesita /css/styles.css, no css/styles.css).
  return '/css/styles.css';
}

async function generateCss(outputDir: string, cwd: string): Promise<void> {
  const targetCssDir = join(outputDir, 'css');
  await mkdir(targetCssDir, { recursive: true });
  const targetCssPath = join(targetCssDir, 'styles.css');

  // Archivo temporal con import absoluto para que Tailwind resuelva rutas correctamente
  // y escanee tanto los templates del CLI como el contenido del proyecto del usuario.
  const tempInputPath = join(tmpdir(), `_iteraciones-${crypto.randomUUID()}.css`);
  await writeFile(tempInputPath, `@import "${CSS_SRC}";\n@source "${PKG_ROOT}";\n@source "${cwd}";\n`, 'utf8');

  try {
    // --bun fuerza el runtime de Bun: no requiere node en PATH.
    // bun x resuelve @tailwindcss/cli desde node_modules local (determinístico).
    const result = await run('bun', ['x', '--bun', '@tailwindcss/cli', '-i', tempInputPath, '-o', targetCssPath, '--minify']);
    if (result.exitCode !== 0) {
      throw new Error(`Tailwind CSS falló:\n${result.stderr}`);
    }
  } finally {
    await rm(tempInputPath, { force: true });
  }
}

async function copyFonts(outputDir: string): Promise<void> {
  const target = join(outputDir, 'fonts');
  // Solo silencia ENOENT (fonts no empaquetadas). Otros errores (permisos, disco) se propagan.
  await cp(FONTS_SRC, target, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.logo?.trim();
  if (!logo) return;

  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch(() => undefined);
}
