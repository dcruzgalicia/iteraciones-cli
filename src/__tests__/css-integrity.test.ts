import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCENT_PALETTES, type AccentColor, accentOverrideBlock } from '../lib/accent-palettes.js';
import { generateAccentCss } from '../lib/generate-css.js';
import { mapWithConcurrency } from '../lib/run.js';

/**
 * Test de integridad del CSS embarcado: regenera el CSS base y el de cada
 * acento con el mismo pipeline del script y los compara con el ensamblado
 * del build. Falla si styles.css, el template HTML o las clases del
 * post-procesamiento (render.ts) cambian sin ejecutar:
 *   bun run scripts/generate-css.ts
 * (y sin regenerar el mapa de paletas para los acentos).
 */
describe('CSS embarcado', () => {
  it('el CSS base coincide con la generación actual (lime, byte a byte)', async () => {
    const committedPath = join(import.meta.dir, '../lib/resources/css/base.css');
    const committed = await Bun.file(committedPath).text();
    const tmpDir = mkdtempSync(join(tmpdir(), 'iteraciones-css-'));
    try {
      const generatedPath = join(tmpDir, 'base.css');
      await generateAccentCss('lime', generatedPath);
      const generated = await Bun.file(generatedPath).text();
      expect(generated).toBe(committed);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('la paleta cubre todos los acentos: base + override replica la compilación directa de Tailwind', async () => {
    const base = await Bun.file(join(import.meta.dir, '../lib/resources/css/base.css')).text();
    const tmpDir = mkdtempSync(join(tmpdir(), 'iteraciones-css-'));
    try {
      const accents = Object.keys(ACCENT_PALETTES);
      await mapWithConcurrency(accents, 4, async (accent) => {
        const generatedPath = join(tmpDir, `${accent}.css`);
        await generateAccentCss(accent, generatedPath);
        const generated = await Bun.file(generatedPath).text();
        const assembled = `${base}\n${accentOverrideBlock(accent as AccentColor)}`;

        // El esqueleto (sin variables de color ni reglas con hex-alpha) debe
        // ser idéntico: lo único que diferencia los acentos son las variables
        // de la paleta y las reglas de opacidad, que el override re-emite.
        expect(skeleton(assembled)).toBe(skeleton(generated));

        // El override re-emite exactamente las reglas accent con hex-alpha
        // que Tailwind calcula para este acento (fallbacks del color-mix).
        const accentHexRules = (generated.match(/\.[^{}]+\{[^{}]*#[0-9a-f]{8}[^}]*\}/g) ?? []).filter((r) => r.includes('accent'));
        for (const rule of accentHexRules) {
          expect(assembled).toContain(rule);
        }
        expect(accentHexRules.length).toBeGreaterThan(0);

        // El override declara las variables del acento
        expect(assembled).toContain(`--color-${accent}-400:${ACCENT_PALETTES[accent as AccentColor][400]}`);
        expect(assembled).toContain(`--color-accent-400:var(--color-${accent}-400)`);
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

/**
 * Quita las declaraciones de variables de color (shades, surface, accent) y
 * las reglas con hex-alpha: lo que queda debe ser idéntico entre acentos.
 */
function skeleton(css: string): string {
  return css
    .replace(/--color-[a-z]+(-[a-z]+)?-\d+:[^;}]+[;}]/g, '')
    .replace(/--color-surface-(light|dark):#[0-9a-f]+[;}]/g, '')
    .replace(/\.[^{}]+\{[^{}]*#[0-9a-f]{8}[^}]*\}/g, '')
    .replace(/:root,:host\{\}/g, '')
    .trimEnd();
}
