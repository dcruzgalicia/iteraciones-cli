import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Crea un proyecto mínimo para tests CLI: un iteraciones.config.yaml
 * y un documento Markdown con frontmatter.
 */
export async function initTestProject(dir: string): Promise<void> {
  await writeFile(
    join(dir, 'iteraciones.config.yaml'),
    ['language: es-MX', 'format:', '  html:', '    title: Test', '    generate: true'].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n', 'utf8');
}

/**
 * Crea un directorio temporal y ejecuta la función de test. Lo limpia al final.
 * Única implementación de la infraestructura de directorios temporales de la
 * suite (antes se reimplementaba con variaciones en ~9 archivos).
 */
export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-cli-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
