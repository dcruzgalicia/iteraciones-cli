import { spyOn } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { runSnapshots, type SnapshotsMode, type SnapshotsOptions } from '../../cli/snapshots.js';
import { exec } from '../../lib/run.js';
import {
  ADDED_BLEND,
  ADDED_TINT,
  clearDiffImages,
  clearSnapshotImages,
  DPI,
  diffImageName,
  FUZZ_PERCENT,
  formatVisualReport,
  formatVisualSummary,
  listPdfFiles,
  listSnapshotImages,
  pngSize,
  REMOVED_BLEND,
  REMOVED_TINT,
  resolveVisualWorkspaces,
  snapshotImageName,
  snapshotStemFor,
  sortPageFiles,
  THRESHOLD_PERCENT,
  visualSlug,
} from '../../lib/visual-diff.js';
import { pdfDeUnaPagina } from '../helpers/pdf.ts';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function pngDe(ancho: number, alto: number, bytes = 24): Uint8Array {
  const buffer = new Uint8Array(bytes);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(buffer.buffer);
  view.setUint32(16, ancho, false);
  view.setUint32(20, alto, false);
  return buffer;
}

function expande(ruta: string): string {
  return ruta
    .replace(/PROYECTO/g, world.root)
    .replace(/<proyecto>/g, world.root)
    .replace(/<temporal>/g, tmpdir());
}

const salidaDir = (): string => join(world.root, 'dist', 'files');

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

Then('el nombre de la página {int} de {word} es {string}', (pagina: number, clase: string, esperado: string) => {
  const leido = clase === 'snap' ? snapshotImageName('index', pagina) : diffImageName('index', pagina);
  if (leido !== esperado) throw new Error(`es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(esperado)}`);
});

Then('el prefijo del snapshot de {string} es {string}', (pdf: string, esperado: string) => {
  const leido = snapshotStemFor(expande(pdf), salidaDir());
  if (leido !== esperado) throw new Error(`el prefijo es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(esperado)}`);
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

When('listo los snapshots guardados', async () => {
  const porStem = await listSnapshotImages(join(world.root, 'snapshots'));
  world.snapshotsGuardados = Object.fromEntries([...porStem].map(([stem, files]) => [stem, files.map((f) => basename(f))]));
});

Then('los snapshots guardados son {string}', (esperados: string) => {
  const leido = Object.entries(world.snapshotsGuardados as Record<string, string[]>)
    .map(([stem, files]) => `${stem}: ${files.join(', ')}`)
    .join(' · ');
  if (leido !== esperados) {
    throw new Error(`son ${JSON.stringify(leido)} y deberían ser ${JSON.stringify(esperados)}`);
  }
});

When('borro los diffs del snapshot {string}', async (slug: string) => {
  await clearDiffImages(world.root, slug === 'todos' ? undefined : slug);
});

When('borro los snapshots del prefijo {string}', async (slug: string) => {
  await clearSnapshotImages(join(world.root, 'snapshots'), slug === 'todos' ? undefined : slug);
});

Then('en el directorio quedan {string}', (esperados: string) => {
  const leidos = readdirSync(world.root).sort().join(', ');
  if (leidos !== esperados) {
    throw new Error(`quedan ${JSON.stringify(leidos)} y deberían quedar ${JSON.stringify(esperados)}`);
  }
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

Then('el caché de los snapshots está en {string}', (esperado: string) => {
  const leido = (world.workspaces as { cachePath?: string }).cachePath ?? 'ninguno';
  if (leido !== expande(esperado)) throw new Error(`está en ${JSON.stringify(leido)} y debería estar en ${JSON.stringify(esperado)}`);
});

Then('la comparación es dpi {int}, umbral {int} y fuzz {int}', (dpi: number, umbral: number, fuzz: number) => {
  if (DPI !== dpi || THRESHOLD_PERCENT !== umbral || FUZZ_PERCENT !== fuzz) {
    throw new Error(`es dpi ${DPI}, umbral ${THRESHOLD_PERCENT}, fuzz ${FUZZ_PERCENT} y el escenario dice otra cosa`);
  }
});

Given('que comparé {int} páginas con {int} sin cambios y {int} modificadas', (comparadas: number, iguales: number, cambiadas: number) => {
  world.comparacion = {
    compared: comparadas,
    unchanged: iguales,
    changed: cambiadas,
    details: [
      { page: 3, diffPercent: 0.4213, diffImage: '/tmp/v/doc/page-003--diff.png' },
      { page: 17, diffPercent: 1.9001, diffImage: '/tmp/v/doc/page-017--diff.png' },
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
    referenceLabel: 'snapshots/index',
    generatedLabel: 'dist/files/index.pdf',
  });
});

When('armo el resumen visual', () => {
  world.resumen = formatVisualSummary(
    {
      compared: 12,
      unchanged: 11,
      changed: 1,
      details: [{ page: 5, diffPercent: 0.0486, diffImage: '/p/diff/index--page-005--diff.png' }],
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

async function correr(pdfs: string[], mode: SnapshotsMode, options: SnapshotsOptions = {}): Promise<void> {
  const salida = spyOn(process.stdout, 'write');
  const error = spyOn(process.stderr, 'write');
  const previo = process.exitCode;
  process.exitCode = 0;
  try {
    await runSnapshots(world.root, pdfs, mode, options);
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

Given('un PDF llamado {string} en la raíz con el texto {string}', (nombre: string, texto: string) => {
  escribirEnProyecto(nombre, '');
  writeFileSync(join(world.root, nombre), pdfDeUnaPagina(texto));
});

Given('la salida tiene estos archivos:', (tabla: string) => {
  for (const linea of tabla.split('\n')) {
    const limpia = linea.trim();
    if (!limpia) continue;
    escribirEnProyecto(join('dist', 'files', limpia), '');
    writeFileSync(join(world.root, 'dist', 'files', limpia), pdfDeUnaPagina(limpia));
  }
});

When('quito el PDF {string} de la salida', (nombre: string) => {
  rmSync(join(world.root, 'dist', 'files', nombre));
});

Given('el directorio de snapshots tiene {string}', (lista: string) => {
  for (const nombre of lista
    .split(';;')
    .map((n) => n.trim())
    .filter(Boolean)) {
    escribirEnProyecto(join('snapshots', nombre), 'no soy un PNG');
  }
});

Given('el directorio de diffs tiene {string}', (lista: string) => {
  for (const nombre of lista
    .split(';;')
    .map((n) => n.trim())
    .filter(Boolean)) {
    escribirEnProyecto(join('diff', nombre), 'x');
  }
});

When('guardo los snapshots de {string}', async (pdfs: string) => {
  await correr(comoLista(pdfs), 'save');
});

When('comparo {string}', async (pdfs: string) => {
  await correr(comoLista(pdfs), 'check');
});

Then('el snapshots termina con código {int}', (codigo: number) => {
  if (world.codigoVisual !== codigo) {
    throw new Error(`el código es ${world.codigoVisual} y el escenario dice ${codigo}`);
  }
});

Then('el snapshots no dice por stdout {string}', (texto: string) => {
  const salida = String(world.stdoutVisual);
  if (salida.includes(texto)) throw new Error(`stdout sí dice ${JSON.stringify(texto)} y no debería:\n${salida}`);
});

Then('el snapshots dice por stdout {string}', (texto: string) => {
  const salida = String(world.stdoutVisual);
  if (!salida.includes(texto)) throw new Error(`stdout no dice ${JSON.stringify(texto)}:\n${salida}`);
});

Then('el snapshots dice por stderr {string}', (texto: string) => {
  const salida = String(world.stderrVisual);
  if (!salida.includes(texto)) throw new Error(`stderr no dice ${JSON.stringify(texto)}:\n${salida}`);
});

interface Color {
  r: number;
  g: number;
  b: number;
  count: number;
}

async function pixelesDelDiff(): Promise<Color[]> {
  const diff = join(world.root, 'diff', 'index--page-001--diff.png');
  const salida = await exec('magick', [diff, '-depth', '8', '-format', '%c', 'histogram:info:']);
  const colores: Color[] = [];
  for (const linea of salida.stdout.split('\n')) {
    const match = /^\s*(\d+):\s*\((\d+),(\d+),(\d+)/.exec(linea);
    if (match === null) continue;
    colores.push({
      count: Number.parseInt(match[1] as string, 10),
      r: Number.parseInt(match[2] as string, 10),
      g: Number.parseInt(match[3] as string, 10),
      b: Number.parseInt(match[4] as string, 10),
    });
  }
  return colores;
}

const esGris = (c: Color): boolean => c.r === c.g && c.g === c.b;
const esRetirado = (c: Color): boolean => !esGris(c) && c.r > c.g;
const esAgregado = (c: Color): boolean => !esGris(c) && c.g > c.r;

function fantasmaDe(lista: Color[], tint: string, blend: string): number {
  const peso = Number.parseInt(blend, 10) / 100;
  if (peso >= 1) {
    throw new Error(
      `la mezcla del tinte ${tint} está al ${blend} %: a partir de 100 el fantasma deja de aportar, el color queda plano y además ya no se puede recuperar para comprobar dónde cayó cada tinta`,
    );
  }
  const rojoDelTinte = Number.parseInt(tint.slice(1, 3), 16);
  const suma = lista.reduce((acc, c) => acc + c.count * ((c.r - rojoDelTinte * peso) / (1 - peso)), 0);
  return suma / lista.reduce((acc, c) => acc + c.count, 0);
}

Then('el diff marca lo borrado en rojo y lo agregado en verde pálido', async () => {
  const pixeles = await pixelesDelDiff();
  const retirados = pixeles.filter(esRetirado);
  const agregados = pixeles.filter(esAgregado);
  if (retirados.length === 0) throw new Error('no hay ni un píxel rojo: lo que se fue del texto no se está marcando');
  if (agregados.length === 0) throw new Error('no hay ni un píxel verde: lo que llegó al texto no se está marcando');
  const fondoRetirado = fantasmaDe(retirados, REMOVED_TINT, REMOVED_BLEND);
  const fondoAgregado = fantasmaDe(agregados, ADDED_TINT, ADDED_BLEND);
  if (fondoRetirado >= fondoAgregado) {
    throw new Error(
      `lo borrado se apoya en un fantasma de ${fondoRetirado.toFixed(0)} y lo agregado en ${fondoAgregado.toFixed(0)}: lo borrado tiene que caer donde la original tenía tinta y lo agregado donde había papel. Están intercambiados.`,
    );
  }
});

Then('el diff deja el resto en el fantasma gris', async () => {
  const pixeles = await pixelesDelDiff();
  const conColor = pixeles.filter((c) => !esGris(c)).reduce((a, c) => a + c.count, 0);
  const teñidos = pixeles.filter((c) => esRetirado(c) || esAgregado(c)).reduce((a, c) => a + c.count, 0);
  if (conColor > teñidos) {
    throw new Error(`${conColor} píxeles con color y sólo ${teñidos} se pueden explicar por los dos tintes: hay un tercer color`);
  }
  const grises = pixeles.filter(esGris).map((c) => c.r);
  const min = Math.min(...grises);
  if (min < 200 || min > 210) {
    throw new Error(`el gris más oscuro del fantasma es ${min} y debería andar en 204: el fantasma dejó de aclarar la original`);
  }
});

Then('el archivo {string} existe en el proyecto', (relativa: string) => {
  if (!existsSync(join(world.root, relativa))) throw new Error(`falta ${relativa}`);
});

Then('el archivo {string} NO existe en el proyecto', (relativa: string) => {
  if (existsSync(join(world.root, relativa))) throw new Error(`existe ${relativa} y no debía`);
});

Then('en snapshots quedan {string}', (esperados: string) => {
  const leidos = readdirSync(join(world.root, 'snapshots')).sort().join(', ');
  if (leidos !== esperados) {
    throw new Error(`quedan ${JSON.stringify(leidos)} y deberían quedar ${JSON.stringify(esperados)}`);
  }
});
