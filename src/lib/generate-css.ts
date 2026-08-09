import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';

/** Raíz del paquete (src/lib/ → raíz del repo). */
const PKG_ROOT = join(import.meta.dir, '..', '..');
const CSS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/**
 * Genera el CSS minificado de un acento (clases del template y del
 * post-procesamiento HTML del paquete) en `targetPath`, invocando
 * @tailwindcss/cli (devDependency del paquete). El tema se resuelve por
 * `data-theme` en el mismo archivo: un CSS por acento cubre light y dark.
 */
export async function generateAccentCss(accent: string, targetPath: string): Promise<void> {
  // Directorio temporal dedicado (vacío salvo el input): Tailwind 4.3 escanea
  // el cwd además de @source, y el repo del paquete o /tmp (scripts con
  // clases en strings) contaminaría el CSS. El input y el cwd viven aquí.
  const tempDir = await mkdtemp(join(tmpdir(), '_iteraciones-css-'));
  const tempInputPath = join(tempDir, `input-${accent}.css`);
  const accentTheme = SHADES.map((s) => `  --color-accent-${s}: var(--color-${accent}-${s});`).join('\n');
  const tempContent = [
    `@import "${CSS_SRC}";`,
    // Fuentes del paquete acotadas a donde viven las clases del HTML generado:
    // template.html (resources) y el post-procesamiento de render.ts (builder).
    // El directorio css/ se excluye: los CSS precompilados no son fuente (si lo
    // fueran, cada regeneración escanearía generaciones anteriores y el output
    // crecería de forma dependiente del orden).
    `@source "${PKG_ROOT}/src/builder";`,
    `@source "${PKG_ROOT}/src/lib/resources";`,
    `@source not "${PKG_ROOT}/src/lib/resources/css";`,
    `@theme {`,
    accentTheme,
    `}`,
  ].join('\n');
  await writeFile(tempInputPath, tempContent, 'utf8');
  try {
    const result = await run('bun', ['x', '--bun', '@tailwindcss/cli', '-i', tempInputPath, '-o', targetPath, '--minify'], {
      cwd: tempDir,
    });
    if (result.exitCode !== 0) throw new Error(`Tailwind CSS falló para el acento ${accent}:\n${result.stderr}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/** Regenera el CSS base embarcado (placeholder lime) en src/lib/resources/css/base.css. */
export async function generateBaseCss(): Promise<void> {
  await generateAccentCss('lime', join(PKG_ROOT, 'src', 'lib', 'resources', 'css', 'base.css'));
}
