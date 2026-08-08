import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAccentCss } from '../lib/generate-css.js';

/**
 * Test de integridad del CSS precompilado: regenera el CSS de un acento con
 * el mismo pipeline del script y lo compara byte a byte con el archivo
 * embarcado. Falla si styles.css, el template HTML o las clases del
 * post-procesamiento (render.ts) cambian sin ejecutar:
 *   bun run scripts/generate-css.ts
 */
describe('CSS precompilado', () => {
  it('el CSS embarcado de lime coincide con la generación actual', async () => {
    const committedPath = join(import.meta.dir, '../lib/resources/css/lime.css');
    const committed = await Bun.file(committedPath).text();
    const tmpDir = mkdtempSync(join(tmpdir(), 'iteraciones-css-'));
    try {
      const generatedPath = join(tmpDir, 'lime.css');
      await generateAccentCss('lime', generatedPath);
      const generated = await Bun.file(generatedPath).text();
      expect(generated).toBe(committed);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
