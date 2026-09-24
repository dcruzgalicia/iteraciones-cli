import { describe, expect, it } from 'bun:test';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2436: el markdown exportado a dist debe ser re-procesable:
 * 1. frontmatter completo (title, subtitle, creator, date, slug, language)
 *    para que el build lo reconstruya igual,
 * 2. body sin transformación de pandoc (sin shift de headings ni pérdida),
 * 3. re-procesar dist como si fuera origen → exactamente el mismo output.
 *
 * Requiere pandoc; sin él, skip informado (decisión D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('md-reprocess.test.ts', SKIP_REASONS.pandoc);

const CONFIG = [
  'language: es-MX',
  'format:',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

describe.skipIf(!pandocOk)('markdown exportado re-procesable (#2436)', () => {
  it('frontmatter completo y re-procesar dist produce exactamente el mismo output', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
      const fuente = [
        '---',
        'title: Ensayo',
        'subtitle: Subtítulo',
        'creator:',
        '  - Autora A',
        'date: 2026-08-08',
        'slug: ensayo',
        '---',
        '',
        '# Capítulo',
        '',
        'Texto con *énfasis*.',
        '',
      ].join('\n');
      await Bun.write(join(dir, 'fuente.md'), `${fuente}\n`);
      // type: creator lleva links: se prependen inline en el body exportado
      // (con guard para no duplicarlos al re-procesar).
      const creativa = [
        '---',
        'title: Creativa',
        'type: creator',
        'links:',
        '  - name: Web',
        '    url: https://ejemplo.com',
        '---',
        '',
        'Cuerpo de la creadora.',
        '',
      ].join('\n');
      await Bun.write(join(dir, 'creativa.md'), `${creativa}\n`);

      process.exitCode = 0;
      const { runBuild } = await import('../cli/dispatcher.js');
      await runBuild(dir);

      const dist = join(dir, 'dist', 'files');
      const exported = await Bun.file(join(dist, 'ensayo.md')).text();
      // 1. Frontmatter completo para re-procesamiento
      expect(exported).toContain('title: Ensayo');
      expect(exported).toContain('subtitle: Subtítulo');
      expect(exported).toContain('- Autora A');
      expect(exported).toContain('date: 2026-08-08');
      expect(exported).toContain('slug: ensayo');
      expect(exported).toContain('language: es-MX');
      // 2. Body sin el shift +4 pandoc (destruía los headings en cada ciclo)
      expect(exported).toContain('\n# Capítulo');
      expect(exported).not.toContain('#####');
      // Los links viajan en el frontmatter Y una sola vez inline en el body
      const creativaMd = await Bun.file(join(dist, 'creativa.md')).text();
      expect(creativaMd).toContain('type: creator');
      expect(creativaMd).toContain('https://ejemplo.com');
      expect(creativaMd.split('https://ejemplo.com').length - 1).toBe(2); // fm + body

      // 3. Re-procesar: dist se usa como proyecto origen
      const dir2 = join(dir, 'reproceso');
      await cp(dist, dir2, { recursive: true });
      await Bun.write(join(dir2, 'iteraciones.config.yaml'), `${CONFIG}\n`);
      await runBuild(dir2);

      const dist2 = join(dir2, 'dist', 'files');
      for (const name of ['ensayo.md', 'ensayo.html', 'creativa.md', 'creativa.html']) {
        const antes = await Bun.file(join(dist, name)).text();
        const despues = await Bun.file(join(dist2, name)).text();
        expect(despues, `re-proceso de ${name} debe ser idéntico`).toBe(antes);
      }
    });
  }, 120_000);
});
