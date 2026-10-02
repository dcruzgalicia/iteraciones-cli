import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { runBuild } from '../../cli/dispatcher.js';

/**
 * #2545 (onda 1) — el markdown exportado a dist debe ser re-procesable.
 *
 * El build es el subject, no una función suelta: se llama a `runBuild` sobre un
 * directorio real y se comparan las dos pasadas byte a byte. Es el escenario que
 * Justifica que exista el feature — leer "compilo dos veces y comparo" dice más
 * que una cadena de asserts sobre `exported`.
 */

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

const FUENTE = [
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

// `type: creator` lleva links: se prependen inline en el body exportado, con
// guard para no duplicarlos al re-procesar.
const CREATIVA = [
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

interface ReprocessWorld {
  dir: string;
  reprocessDir: string;
}

const world: ReprocessWorld = { dir: '', reprocessDir: '' };

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

async function distFiles(root: string): Promise<string> {
  return join(root, 'dist', 'files');
}

Given('un proyecto con salida en HTML y Markdown', async () => {
  await Bun.write(join(world.dir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
});

Given('un documento {string} con título, subtítulo, autora, fecha y slug', async (slug: string) => {
  await Bun.write(join(world.dir, `${slug}.md`), `${FUENTE}\n`);
});

Given('una creativa con un enlace en su frontmatter', async () => {
  await Bun.write(join(world.dir, 'creativa.md'), `${CREATIVA}\n`);
});

When('compilo el proyecto', async () => {
  process.exitCode = 0;
  await runBuild(world.dir);
});

Then('el markdown exportado lleva el frontmatter completo', async () => {
  const exported = await readFile(join(await distFiles(world.dir), 'ensayo.md'), 'utf8');
  for (const expected of ['title: Ensayo', 'subtitle: Subtítulo', '- Autora A', 'date: 2026-08-08', 'slug: ensayo', 'language: es-MX']) {
    if (!exported.includes(expected)) throw new Error(`falta "${expected}" en el frontmatter exportado:\n${exported.slice(0, 400)}`);
  }
});

Then('el markdown exportado conserva el heading sin desplazar', async () => {
  const exported = await readFile(join(await distFiles(world.dir), 'ensayo.md'), 'utf8');
  // El shift +4 de pandoc destruía los headings en cada ciclo (#2436).
  if (!exported.includes('\n# Capítulo')) throw new Error('el heading no conservó su nivel');
  if (exported.includes('#####')) throw new Error('el heading llegó desplazado por el shift de pandoc');
});

Then('la creativa lleva su enlace en el frontmatter y una vez en el cuerpo', async () => {
  const creative = await readFile(join(await distFiles(world.dir), 'creativa.md'), 'utf8');
  if (!creative.includes('type: creator')) throw new Error('falta type: creator');
  // frontmatter + cuerpo = 2 apariciones. Una tercera sería el bug de duplicar.
  const count = creative.split('https://ejemplo.com').length - 1;
  if (count !== 2) throw new Error(`esperaba 2 apariciones del enlace (frontmatter + cuerpo) y hubo ${count}`);
});

When('uso dist como proyecto origen y compilo de nuevo', async () => {
  world.reprocessDir = join(world.dir, 'reproceso');
  await mkdir(world.reprocessDir, { recursive: true });
  await cp(await distFiles(world.dir), world.reprocessDir, { recursive: true });
  await Bun.write(join(world.reprocessDir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
  await runBuild(world.reprocessDir);
});

Then('todas las salidas son idénticas a la primera pasada', async () => {
  const first = await distFiles(world.dir);
  const second = await distFiles(world.reprocessDir);
  for (const name of ['ensayo.md', 'ensayo.html', 'creativa.md', 'creativa.html']) {
    const before = await readFile(join(first, name), 'utf8');
    const after = await readFile(join(second, name), 'utf8');
    if (after !== before) throw new Error(`el re-proceso de ${name} no es idéntico`);
  }
});
