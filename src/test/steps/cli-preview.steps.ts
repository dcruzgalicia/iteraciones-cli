import { spyOn } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import { changedSince, previewInputs, runPreview, type Snapshot, takeSnapshot } from '../../cli/preview.js';
import { escribirEnProyecto, raiz, sinColor, world } from './cli-world.steps.js';

const POLL_MS = 20;
const LOCKFILE = '.iteraciones/preview.lock';

const stdoutLimpio = (): string => sinColor(world.stdout);
const stderrLimpio = (): string => sinColor(world.stderr);
const cuenta = (aguja: string): number => stdoutLimpio().split(aguja).length - 1;

async function esperarA(condicion: () => boolean, ms = 20_000): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicion()) return;
    await Bun.sleep(20);
  }
  throw new Error(`la condición no se cumplió en ${ms}ms.\nstdout: ${stdoutLimpio()}\nstderr: ${stderrLimpio()}`);
}

async function previewVigila(): Promise<void> {
  await esperarA(() => stdoutLimpio().includes('vigilando cambios'));
}

After(async () => {
  process.emit('SIGTERM');
  await world.previewListo;
  if (world.root) rmSync(join(world.root, LOCKFILE), { force: true });
});

Given('que el proyecto tiene el documento {string}', (relativa: string) => {
  escribirEnProyecto(relativa, '---\ntitle: Vigila\ndate: 2026-01-01\n---\n\nCuerpo.\n');
});

Given('que el proyecto tiene un filtro {string}', (relativa: string) => {
  escribirEnProyecto(relativa, '-- filtro de prueba\n');
});

Given('que el proyecto tiene una bibliografía', () => {
  escribirEnProyecto('bibliography.bib', '@book{k1, title={T}}\n');
});

Given('que el proyecto tiene el lockfile con el pid {int}', (pid: number) => {
  escribirEnProyecto(LOCKFILE, String(pid));
});

When('tomo la lista de entradas de preview', async () => {
  raiz();
  world.entradasPreview = await previewInputs(world.root);
});

Then('la lista de entradas de preview incluye {string}', (relativa: string) => {
  const entradas = world.entradasPreview ?? [];
  if (!entradas.includes(join(world.root, relativa))) {
    throw new Error(`la lista no incluye ${relativa}. Va:\n${entradas.join('\n')}`);
  }
});

Then('la lista de entradas de preview excluye {string}', (relativa: string) => {
  const entradas = world.entradasPreview ?? [];
  if (entradas.includes(join(world.root, relativa))) {
    throw new Error(`la lista no debería incluir ${relativa}. Va:\n${entradas.join('\n')}`);
  }
});

Given('que tengo el snapshot de las entradas de preview', async () => {
  world.snapshotPrevio = await takeSnapshot(world.entradasPreview ?? []);
});

Given('que el snapshot previo está vacío', () => {
  world.snapshotPrevio = new Map();
});

When('tomo un snapshot nuevo de las entradas de preview', async () => {
  world.entradasPreview = await previewInputs(world.root);
  world.snapshotNuevo = await takeSnapshot(world.entradasPreview);
});

When('cambio el contenido del archivo {string}', async (relativa: string) => {
  const absoluta = join(world.root, relativa);
  const antes = await Bun.file(absoluta).text();
  await Bun.sleep(10);
  await Bun.write(absoluta, `${antes}\n\nLínea nueva.\n`);
});

When('borro el archivo {string}', (relativa: string) => {
  rmSync(join(world.root, relativa));
});

Then('los cambios detectados son {string}', (esperados: string) => {
  const lista = esperados
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const previos: Snapshot = world.snapshotPrevio ?? new Map();
  const nuevos: Snapshot = world.snapshotNuevo ?? new Map();
  const cambios = changedSince(previos, nuevos)
    .map((ruta) => ruta.slice(world.root.length + 1))
    .sort();
  if (JSON.stringify(cambios) !== JSON.stringify([...lista].sort())) {
    throw new Error(`los cambios fueron ${JSON.stringify(cambios)} y esperaba ${JSON.stringify(lista)}`);
  }
});

function capturarVivo(fn: () => Promise<void>): Promise<void> {
  world.stdout = '';
  world.stderr = '';
  process.exitCode = 0;
  const out = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    world.stdout += String(chunk);
    return true;
  });
  const err = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    world.stderr += String(chunk);
    return true;
  });
  return fn()
    .then(() => {
      world.exitCode = Number(process.exitCode ?? 0);
    })
    .finally(() => {
      out.mockRestore();
      err.mockRestore();
    });
}

When('arranco preview', () => {
  raiz();
  world.previewListo = capturarVivo(() => runPreview(world.root, { pollMs: POLL_MS }));
});

Then('preview construyó el proyecto una vez y quedó esperando', async () => {
  await previewVigila();
  if (cuenta('Todo listo.') !== 1) {
    throw new Error(`esperaba un solo build inicial y hubo ${cuenta('Todo listo.')}:\n${stdoutLimpio()}`);
  }
});

When('cambio un documento mientras preview vigila', async () => {
  await previewVigila();
  const buildsAntes = cuenta('Todo listo.');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido cambiado.\n');
  await esperarA(() => stdoutLimpio().includes('cambio: test.md'));
  await esperarA(() => cuenta('Todo listo.') > buildsAntes);
});

Then('preview nombra el archivo que cambió', () => {
  if (!stdoutLimpio().includes('cambio: test.md')) {
    throw new Error(`preview no nombra el archivo que cambió:\n${stdoutLimpio()}`);
  }
});

Then('preview reconstruyó exactamente una vez más', () => {
  if (cuenta('Todo listo.') !== 2) {
    throw new Error(`esperaba 2 builds en total y hubo ${cuenta('Todo listo.')}:\n${stdoutLimpio()}`);
  }
});

When('rompo la configuración mientras preview vigila', async () => {
  await previewVigila();
  escribirEnProyecto('iteraciones.config.yaml', ':: yaml inválido ::');
  await esperarA(() => stderrLimpio().includes('✖'));
});

Then('preview se recupera del error y sigue vigilando', async () => {
  const buildsAntes = cuenta('Todo listo.');
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: true\n');
  await esperarA(() => cuenta('Todo listo.') > buildsAntes);
  if (!stdoutLimpio().includes('vigilando cambios')) {
    throw new Error(`preview dejó de vigilar:\n${stdoutLimpio()}`);
  }
});

When('hago dos cambios seguidos antes de que corra el poll', async () => {
  await previewVigila();
  const buildsAntes = cuenta('Todo listo.');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nUno.\n');
  escribirEnProyecto('otro.md', '---\ntitle: Otro\ndate: 2026-01-02\n---\n\nDos.\n');
  await esperarA(() => cuenta('Todo listo.') > buildsAntes);
  await Bun.sleep(500);
});

When('cambio algo mientras el build corre', async () => {
  await previewVigila();
  const buildsAntes = cuenta('Todo listo.');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nUno.\n');
  await esperarA(() => stdoutLimpio().includes('cambio: test.md'));
  escribirEnProyecto('otro.md', '---\ntitle: Otro\ndate: 2026-01-02\n---\n\nDos.\n');
  await esperarA(() => cuenta('Todo listo.') > buildsAntes + 1);
  await Bun.sleep(500);
});

Then('los builds se estabilizan en {int}', (total: number) => {
  if (cuenta('Todo listo.') !== total) {
    throw new Error(`esperaba ${total} builds en total y hubo ${cuenta('Todo listo.')}:\n${stdoutLimpio()}`);
  }
});

When('paro preview', async () => {
  process.emit('SIGTERM');
  await world.previewListo;
});

Then('el lockfile de preview no queda en disco', async () => {
  if (await Bun.file(join(world.root, LOCKFILE)).exists()) {
    throw new Error('el lockfile sigue en disco después de parar el preview');
  }
});

Then('el lockfile de preview lleva el pid del proceso', async () => {
  const contenido = (await Bun.file(join(world.root, LOCKFILE)).text()).trim();
  if (contenido !== String(process.pid)) {
    throw new Error(`el lockfile dice ${JSON.stringify(contenido)} y el pid del proceso es ${process.pid}`);
  }
});

Then('preview termina con el código de salida {int}', (codigo: number) => {
  if ((world.exitCode ?? 0) !== codigo) {
    throw new Error(`esperaba el código de salida ${codigo} y hubo ${world.exitCode ?? 0}`);
  }
});

Then('un preview anterior queda en el lockfile', () => {
  const contenido = world.stdout;
  if (!contenido.includes('terminando el preview anterior')) {
    throw new Error(`preview no_avisa del preview anterior:\n${stdoutLimpio()}`);
  }
});
