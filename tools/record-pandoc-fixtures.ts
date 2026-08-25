/**
 * Regenera los fixtures de salida de pandoc para el major ACTUAL
 * (issue #2031): ejecuta pandoc real sobre sample.md y escribe sample.latex /
 * sample.html en src/__tests__/fixtures/pandoc/<major>/. Requiere pandoc.
 *
 * Uso: bun tools/record-pandoc-fixtures.ts
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execPandoc, getPandocVersion } from '../src/lib/pandoc-runner.js';

const version = await getPandocVersion();
const major = version.match(/pandoc (\d+)\./)?.[1];
if (!major) throw new Error(`no se pudo parsear la versión: ${version}`);
const dir = join(import.meta.dir, '../src/__tests__/fixtures/pandoc', major);
await mkdir(dir, { recursive: true });

const samplePath = join(dir, 'sample.md');
const sample = (await Bun.file(samplePath).exists()) ? await Bun.file(samplePath).text() : null;
if (sample === null) throw new Error(`falta ${samplePath}: los fixtures se regeneran sobre el sample versionado`);

for (const to of ['latex', 'html5'] as const) {
  const out = await execPandoc({ input: sample, sourcePath: samplePath, from: 'markdown+auto_identifiers+mark', to });
  const ext = to === 'latex' ? 'latex' : 'html';
  await Bun.write(join(dir, `sample.${ext}`), out);
  console.log(`✓ ${join(dir, `sample.${ext}`)} (${out.length} bytes)`);
}
console.log(`Fixtures de pandoc ${version} registrados en ${dir}`);
