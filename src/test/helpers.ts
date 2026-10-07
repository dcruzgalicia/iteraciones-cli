import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Crea un proyecto mínimo para tests CLI: un iteraciones.config.yaml
 * y un documento Markdown con frontmatter.
 *
 * Sincrónico a propósito: los pasos de contenido de archivo de cucumber tienen
 * que ser sincrónicos, y un `writeFile` asíncrono los volvería `async`.
 */
export function initTestProject(dir: string): void {
  writeFileSync(
    join(dir, 'iteraciones.config.yaml'),
    ['language: es-MX', 'format:', '  html:', '    site:', '      title: Test', '    generate: true'].join('\n'),
    'utf8',
  );
  writeFileSync(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n', 'utf8');
}

/**
 * Las primitivas y operadores que un `build.sh` no debe usar.
 *
 * Compartido: `build-sh` y `script-de-build` comparan el script grabado contra
 * la misma lista, y el criterio tiene que ser el mismo en los dos features.
 */
export function systemCommands(script: string): string[] {
  const found = new Set<string>();
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('set ') || line.startsWith('cd ') || line.startsWith('(cd ')) continue;
    const token = /^[A-Za-z0-9_./-]+/.exec(line.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+ )+/, ''))?.[0] ?? '';
    const name = token.split('/').at(-1) ?? '';
    if (['cp', 'rm', 'ln', 'rmdir'].includes(name)) found.add(name);
    if (line.includes(' && ')) found.add('&&');
  }
  return [...found].sort();
}
