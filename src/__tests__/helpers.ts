import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Crea un proyecto mínimo para tests CLI: un iteraciones.config.yaml
 * y un documento Markdown con frontmatter.
 */
export async function initTestProject(dir: string): Promise<void> {
  await writeFile(
    join(dir, 'iteraciones.config.yaml'),
    ['lang: es-MX', 'format:', '  html:', '    title: Test', '    generate: true'].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n', 'utf8');
}
