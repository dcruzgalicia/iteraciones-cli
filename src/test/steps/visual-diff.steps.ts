import { spyOn } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { runTestVisual, type TestVisualOptions } from '../../cli/test-visual.js';
import {
  blurSigmaFor,
  clearDiffImages,
  diffImageName,
  diffTargetFor,
  formatVisualReport,
  formatVisualSummary,
  listPdfFiles,
  pngSize,
  referencePathFor,
  resolveVisualOptions,
  resolveVisualWorkspaces,
  sortPageFiles,
  visualSlug,
} from '../../lib/visual-diff.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function pngDe(ancho: number, alto: number, bytes = 24): Uint8Array {
  const buffer = new Uint8Array(bytes);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(buffer.buffer);
  view.setUint32(16, ancho, false);
  view.setUint32(20, alto, false);
  return buffer;
}

Given('que tengo un PNG de {int} por {int}', (ancho: number, alto: number) => {
  world.png = pngDe(ancho, alto);
});

Given('que tengo algo que no es un PNG de {int} bytes', (bytes: number) => {
  world.png = new Uint8Array(bytes);
});

Then('el PNG mide {int} por {int}', (ancho: number, alto: number) => {
  const leido = pngSize(world.png as Uint8Array);
  if (leido?.width !== ancho || leido?.height !== alto) {
    throw new Error(`mide ${JSON.stringify(leido)} y debería medir ${ancho}x${alto}`);
  }
});

Then('el PNG no tiene tamaño legible', () => {
  if (pngSize(world.png as Uint8Array) !== null) {
    throw new Error(`mide ${JSON.stringify(pngSize(world.png as Uint8Array))} y no debería medir nada`);
  }
});

When('ordeno las páginas {string}', (archivos: string) => {
  world.ordenadas = sortPageFiles(archivos.split(',').map((a) => a.trim()));
});

Then('el orden es {string}', (esperado: string) => {
  const leido = (world.ordenadas as string[]).join(', ');
  if (leido !== esperado) throw new Error(`el orden es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(esperado)}`);
});

Then('el slug de {string} es {string}', (ruta: string, esperado: string) => {
  const leido = visualSlug(expande(ruta));
  if (leido !== esperado) throw new Error(`el slug es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(esperado)}`);
});

Then('el snapshot de {string} vive en {string}', (pdf: string, esperado: string) => {
  const leido = referencePathFor(world.root, expande(pdf), `${world.root}/dist/files`);
  const relativo = leido.replace(`${world.root}/`, '');
  if (relativo !== esperado) throw new Error(`vive en ${JSON.stringify(relativo)} y debería vivir en ${JSON.stringify(esperado)}`);
});

Then('el nombre del diff de la página {int} es {string}', (pagina: number, esperado: string) => {
  const leido = diffImageName('index', pagina);
  if (leido !== esperado) throw new Error(`es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(esperado)}`);
});

Then('el diff de {string} va junto a su snapshot', (pdf: string) => {
  const { dir, stem } = diffTargetFor(expande(pdf));
  if (!dir.endsWith('visual/anexos') || stem !== 'index') {
    throw new Error(`va a ${JSON.stringify({ dir, stem })} y debería ir junto al snapshot`);
  }
});

Given('que el directorio de salida tiene {string}', (archivos: string) => {
  for (const nombre of archivos
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)) {
    const ruta = join(world.root, nombre);
    mkdirSync(join(ruta, '..'), { recursive: true });
    writeFileSync(ruta, 'x', 'utf8');
  }
});

When('listo los PDF de la salida', async () => {
  world.pdfs = await listPdfFiles(world.root);
});

Then('los PDF son {string}', (esperados: string) => {
  const leidos = (world.pdfs as string[]).map((p) => p.replace(`${world.root}/`, '')).join(', ');
  if (leidos !== esperados) {
    throw new Error(`son ${JSON.stringify(leidos)} y deberían ser ${JSON.stringify(esperados)}`);
  }
});

When('borro los diffs del snapshot {string}', async (slug: string) => {
  await clearDiffImages(world.root, slug === 'todos' ? undefined : slug);
});

Then('en el directorio quedan {string}', (esperados: string) => {
  const leidos = readdirSync(world.root).sort().join(', ');
  if (leidos !== esperados) {
    throw new Error(`quedan ${JSON.stringify(leidos)} y deberían quedar ${JSON.stringify(esperados)}`);
  }
});

Then('el desenfoque a {int} dpi es {int}', (dpi: number, sigma: number) => {
  const leido = blurSigmaFor(dpi);
  if (leido !== sigma) throw new Error(`el desenfoque es ${leido} y debería ser ${sigma}`);
});

Given('que el proyecto tiene configuración', () => {
  writeFileSync(join(world.root, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
});

Given('que el proyecto no tiene configuración', () => {});

When('resuelvo el directorio de trabajo del snapshot {string}', async (slug: string) => {
  world.workspaces = await resolveVisualWorkspaces(world.root, slug);
});

Then('el directorio de trabajo está en {string}', (esperado: string) => {
  const leido = (world.workspaces as { workDir: string }).workDir;
  if (leido !== expande(esperado)) {
    throw new Error(`está en ${JSON.stringify(leido)} y debería estar en ${JSON.stringify(esperado)}`);
  }
});

Then('el directorio de trabajo queda bajo {string} y termina en {string}', (base: string, slug: string) => {
  const leido = (world.workspaces as { workDir: string }).workDir;
  const raiz = expande(base);
  if (!leido.startsWith(raiz)) throw new Error(`${JSON.stringify(leido)} no está bajo ${JSON.stringify(raiz)}`);
  if (basename(leido) !== slug) throw new Error(`${JSON.stringify(leido)} no termina en ${JSON.stringify(slug)}`);
  if (dirname(leido) === raiz) throw new Error(`el directorio intermedio no separa proyectos: ${JSON.stringify(leido)}`);
});

Then('el directorio de trabajo no se comparte con otro proyecto', async () => {
  const otro = await mkdtemp(join(tmpdir(), 'iteraciones-otro-'));
  const a = await resolveVisualWorkspaces(world.root, 'doc');
  const b = await resolveVisualWorkspaces(otro, 'doc');
  if (a.workDir === b.workDir) throw new Error(`dos proyectos comparten ${JSON.stringify(a.workDir)}`);
  await rm(otro, { recursive: true, force: true });
});

Then('el caché del visual está en {string}', (esperado: string) => {
  const leido = (world.workspaces as { cachePath?: string }).cachePath ?? 'ninguno';
  if (leido !== expande(esperado)) throw new Error(`está en ${JSON.stringify(leido)} y debería estar en ${JSON.stringify(esperado)}`);
});

Then('los valores por defecto son dpi {int}, umbral {string} y fuzz {int}', (dpi: number, umbral: string, fuzz: number) => {
  const o = resolveVisualOptions();
  if (o.dpi !== dpi || o.thresholdPercent !== Number(umbral) || o.fuzzPercent !== fuzz) {
    throw new Error(`son ${JSON.stringify(o)} y deberían ser los del escenario`);
  }
});

When('resuelvo las opciones visuales con {string}', (flags: string) => {
  const dado = Object.fromEntries(
    flags.split(',').map((par) => {
      const [k, v] = par.split('=');
      return [k?.trim() ?? '', v ?? ''];
    }),
  ) as Record<string, string>;
  try {
    world.opcionesVisuales = resolveVisualOptions(dado);
    world.errorVisual = '';
  } catch (e) {
    world.errorVisual = (e as Error).message;
    world.opcionesVisuales = null;
  }
});

Then('las opciones son dpi {int}, umbral {string} y fuzz {int}', (dpi: number, umbral: string, fuzz: number) => {
  const o = world.opcionesVisuales as { dpi: number; thresholdPercent: number; fuzzPercent: number } | null;
  if (o?.dpi !== dpi || o.thresholdPercent !== Number(umbral) || o.fuzzPercent !== fuzz) {
    throw new Error(`son ${JSON.stringify(o)} y deberían ser las del escenario`);
  }
});

Then('las opciones visuales fallan diciendo {string}', (motivo: string) => {
  if (!world.errorVisual) throw new Error('no falló y debía');
  if (!world.errorVisual.includes(motivo)) {
    throw new Error(`no dice ${JSON.stringify(motivo)}. Dijo: ${world.errorVisual}`);
  }
});

Given('que comparé {int} páginas con {int} sin cambios y {int} modificadas', (comparadas: number, iguales: number, cambiadas: number) => {
  world.comparacion = {
    compared: comparadas,
    unchanged: iguales,
    changed: cambiadas,
    details: [
      { page: 3, diffPercent: 0.4213, diffImage: '/tmp/v/doc/page-003-diff.png' },
      { page: 17, diffPercent: 1.9001, diffImage: '/tmp/v/doc/page-017-diff.png' },
    ],
    referencePages: comparadas,
    generatedPages: comparadas,
    pass: cambiadas === 0,
    diffDir: '/tmp/v/doc',
  };
});

Given('que comparé contra una referencia con {int} páginas y generé {int}', (referencia: number, generadas: number) => {
  world.comparacion = {
    compared: Math.min(referencia, generadas),
    unchanged: 1,
    changed: 0,
    details: [],
    referencePages: referencia,
    generatedPages: generadas,
    pass: false,
  };
});

When('armo el informe visual', () => {
  world.informe = formatVisualReport({
    result: world.comparacion as Parameters<typeof formatVisualReport>[0]['result'],
    options: { dpi: 300, thresholdPercent: 0.005, fuzzPercent: 15 },
    referenceLabel: 'visual/index.pdf',
    generatedLabel: 'dist/files/index.pdf',
  });
});

When('armo el resumen visual', () => {
  world.resumen = formatVisualSummary(
    {
      compared: 12,
      unchanged: 11,
      changed: 1,
      details: [{ page: 5, diffPercent: 0.0486, diffImage: '/p/visual/index-page-005-diff.png' }],
      referencePages: 12,
      generatedPages: 12,
      pass: false,
    },
    (ruta) => ruta.replace('/p/', ''),
  );
});

Then('el informe dice {string}', (texto: string) => {
  if (!(world.informe as string).includes(texto)) {
    throw new Error(`el informe no dice ${JSON.stringify(texto)}:\n${world.informe}`);
  }
});

Then('el resumen dice {string}', (texto: string) => {
  if (!(world.resumen as string[]).includes(texto)) {
    throw new Error(`el resumen no dice ${JSON.stringify(texto)}. Dice ${JSON.stringify(world.resumen)}`);
  }
});

function expande(ruta: string): string {
  return ruta
    .replace(/PROYECTO/g, world.root)
    .replace(/<proyecto>/g, world.root)
    .replace(/<temporal>/g, tmpdir());
}

async function correrVisual(pdfs: string[], opciones: TestVisualOptions): Promise<void> {
  const salida = spyOn(process.stdout, 'write');
  const error = spyOn(process.stderr, 'write');
  const previo = process.exitCode;
  process.exitCode = 0;
  try {
    await runTestVisual(world.root, pdfs, opciones);
    world.codigoVisual = process.exitCode ?? 0;
    world.stdoutVisual = salida.mock.calls.map((a) => a.map(String).join('')).join('');
    world.stderrVisual = error.mock.calls.map((a) => a.map(String).join('')).join('');
  } finally {
    salida.mockRestore();
    error.mockRestore();
    process.exitCode = previo;
  }
}

const comoLista = (pdfs: string): string[] =>
  pdfs
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

Given('un PDF llamado {string} en la raíz', (nombre: string) => {
  escribirEnProyecto(nombre, 'contenido');
});

Given('la salida tiene estos archivos:', (tabla: string) => {
  for (const linea of tabla.split('\n')) {
    const limpia = linea.trim();
    if (limpia) escribirEnProyecto(join('dist', 'files', limpia), limpia.endsWith('.pdf') ? 'contenido' : 'no soy un PDF');
  }
});

Given('el directorio de snapshots tiene {string}', (lista: string) => {
  for (const nombre of lista
    .split(';;')
    .map((n) => n.trim())
    .filter(Boolean)) {
    escribirEnProyecto(join('visual', nombre), 'x');
  }
});

When('creo el snapshot de {string} con {string}', async (pdfs: string, flags: string) => {
  await correrVisual(comoLista(pdfs), { ...opcionesVisuales(flags), update: true });
});

When('comparo {string} con {string}', async (pdfs: string, flags: string) => {
  await correrVisual(comoLista(pdfs), opcionesVisuales(flags));
});

function opcionesVisuales(flags: string): TestVisualOptions {
  const salida: Record<string, unknown> = {};
  for (const par of flags
    .split(';;')
    .map((f) => f.trim())
    .filter(Boolean)) {
    const [clave, valor] = par.split('=');
    if (!clave) continue;
    if (clave === 'update') salida.update = valor !== 'false';
    else salida[clave] = valor;
  }
  return salida as TestVisualOptions;
}

Then('el visual termina con código {int}', (codigo: number) => {
  if (world.codigoVisual !== codigo) {
    throw new Error(`el código es ${world.codigoVisual} y el escenario dice ${codigo}`);
  }
});

Then('el visual dice por stdout {string}', (texto: string) => {
  const salida = String(world.stdoutVisual);
  if (!salida.includes(texto)) throw new Error(`stdout no dice ${JSON.stringify(texto)}:\n${salida}`);
});

Then('el visual dice por stderr {string}', (texto: string) => {
  const salida = String(world.stderrVisual);
  if (!salida.includes(texto)) throw new Error(`stderr no dice ${JSON.stringify(texto)}:\n${salida}`);
});

Then('el archivo {string} existe en el proyecto', (relativa: string) => {
  if (!existsSync(join(world.root, relativa))) throw new Error(`falta ${relativa}`);
});

Then('el archivo {string} NO existe en el proyecto', (relativa: string) => {
  if (existsSync(join(world.root, relativa))) throw new Error(`existe ${relativa} y no debía`);
});

Then('en las referencias quedan {string}', (esperados: string) => {
  const leidos = readdirSync(join(world.root, 'visual')).sort().join(', ');
  const queried = esperados.trim();
  if (leidos !== queried) {
    throw new Error(`quedan ${JSON.stringify(leidos)} y deberían quedar ${JSON.stringify(queried)}`);
  }
});
