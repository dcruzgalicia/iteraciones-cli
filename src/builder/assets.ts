import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CacheManager } from '../cache/cache-manager.js';
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
export async function buildAssets(
  outputDir: string,
  cwd: string,
  siteConfig: SiteConfig,
  options: { noTailwind?: boolean; cacheManager?: CacheManager } = {},
): Promise<string> {
  const tasks: Promise<void>[] = [copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)];
  if (!options.noTailwind) tasks.push(generateCss(outputDir, cwd, siteConfig.format?.html?.accent ?? 'lime', options.cacheManager));
  await Promise.all(tasks);
  // Cuando noTailwind está activo no se genera styles.css, así que retornamos ''
  // para que buildSiteContext produzca css:[] y el template omita el <link>.
  // Ruta absoluta desde la raíz del sitio para que funcione en páginas anidadas
  // (p.ej. posts/a.html necesita /css/styles.css, no css/styles.css).
  return options.noTailwind ? '' : '/css/styles.css';
}

async function generateCss(outputDir: string, cwd: string, accent: string, cacheManager?: CacheManager): Promise<void> {
  const targetCssDir = join(outputDir, 'css');
  await mkdir(targetCssDir, { recursive: true });
  const targetCssPath = join(targetCssDir, 'styles.css');

  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const accentTheme = shades.map((s) => `  --color-accent-${s}: var(--color-${accent}-${s});`).join('\n');

  if (cacheManager) {
    // Clave de caché: hash de todos los templates HTML del CLI + styles.css + accent.
    // Si ninguno de estos inputs cambia, el CSS generado es idéntico.
    const hasher = new Bun.CryptoHasher('sha256');
    const htmlGlob = new Bun.Glob('**/*.html');
    for await (const relPath of htmlGlob.scan({ cwd: PKG_ROOT })) {
      const content = await Bun.file(join(PKG_ROOT, relPath)).text();
      hasher.update(relPath);
      hasher.update('\0');
      hasher.update(content);
      hasher.update('\0');
    }
    const cssSource = await Bun.file(CSS_SRC).text();
    hasher.update(cssSource);
    hasher.update('\0');
    hasher.update(accent);
    hasher.update('\0');
    const cssKey = hasher.digest('hex');

    const cached = await cacheManager.read('css', cssKey);
    if (cached !== undefined) {
      await Bun.write(targetCssPath, cached);
      return;
    }

    const generated = await buildCssWithTailwind(targetCssPath, cwd, accentTheme);
    await cacheManager.write('css', cssKey, generated);
    return;
  }

  await buildCssWithTailwind(targetCssPath, cwd, accentTheme);
}

async function buildCssWithTailwind(targetCssPath: string, cwd: string, accentTheme: string): Promise<string> {
  // Archivo temporal con import absoluto para que Tailwind resuelva rutas correctamente
  // y escanee tanto los templates del CLI como el contenido del proyecto del usuario.
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
    // --bun fuerza el runtime de Bun: no requiere node en PATH.
    // bun x resuelve @tailwindcss/cli desde node_modules local (determinístico).
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
  // Solo silencia ENOENT (fonts no empaquetadas). Otros errores (permisos, disco) se propagan.
  await cp(FONTS_SRC, target, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.logo?.trim();
  if (!logo) return;

  // Guardia de seguridad: rechazar rutas con segmento '..' o absolutas.
  // Se comparan segmentos exactos para no rechazar nombres como "my..logo.png".
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    process.stderr.write(`[assets] logo: ruta inválida "${logo}" — debe ser relativa al proyecto\n`);
    process.exitCode = 1;
    return;
  }

  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      // Archivo no encontrado: advertencia leve, el build puede continuar sin logo.
      process.stderr.write(`[assets] logo no encontrado: "${logo}"\n`);
    } else {
      // Error de sistema (permisos, I/O): señalar fallo al igual que path traversal.
      process.stderr.write(`[assets] No se pudo copiar el logo "${logo}": ${err.message}\n`);
      process.exitCode = 1;
    }
  });
}
