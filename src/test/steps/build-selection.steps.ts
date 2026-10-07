import { spyOn } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { runBuild } from '../../cli/dispatcher.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function mapaDeDist(raiz: string): Record<string, string> {
  const salida: Record<string, string> = {};
  const base = join(raiz, 'dist');
  let archivos: string[] = [];
  try {
    archivos = readdirSync(base, { recursive: true } as { recursive: true }).map(String);
  } catch {
    return salida;
  }
  for (const archivo of archivos) {
    const completa = join(base, archivo);
    try {
      if (statSync(completa).isFile()) {
        salida[archivo] = readFileSync(completa).toString('base64');
      }
    } catch {}
  }
  return salida;
}

Given('que los paths a compilar son {string}', (paths: string) => {
  world.pathsSeleccion = paths
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
});

Given('que guardo la referencia del dist', () => {
  world.distReferencia = mapaDeDist(world.root);
});

Given('que borro el estado del build', () => {
  rmSync(join(world.root, '.iteraciones'), { recursive: true, force: true });
  rmSync(join(world.root, 'dist'), { recursive: true, force: true });
});

When('hago un build completo', async () => {
  await runBuild(world.root);
});

When('hago un build solo de los paths indicados', async () => {
  await runBuild(world.root, { only: world.pathsSeleccion });
});

Then('el dist sale byte a byte igual que la referencia', () => {
  const ahora = mapaDeDist(world.root);
  const ref = world.distReferencia as Record<string, string>;
  const nuevos = Object.keys(ahora).filter((k) => !(k in ref));
  const distintos = Object.keys(ref).filter((k) => ahora[k] !== ref[k]);
  if (nuevos.length > 0 || distintos.length > 0) {
    throw new Error(`nuevos: ${JSON.stringify(nuevos.slice(0, 5))}; distintos: ${JSON.stringify(distintos.slice(0, 5))}`);
  }
});

Then('los documentos no seleccionados no cambian', () => {
  const ahora = mapaDeDist(world.root);
  const ref = world.distReferencia as Record<string, string>;
  const fuera = Object.keys(ref).filter((k) => !(k in world.pathsSeleccion));
  const distintos = fuera.filter((k) => ahora[k] !== ref[k]);
  if (distintos.length > 0) {
    throw new Error(`cambiaron sin estar seleccionados: ${JSON.stringify(distintos.slice(0, 5))}`);
  }
});

const CONFIG_SELECCION = [
  'language: es-MX',
  'format:',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

function documentales(): string[] {
  const salida: string[] = [];
  const base = join(world.root, 'dist', 'files');
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (ruta.endsWith('.html') || ruta.endsWith('.md')) {
        salida.push(relative(join(world.root, 'dist', 'files'), ruta));
      }
    }
  };
  try {
    recorrer(base);
  } catch {
    return [];
  }
  return salida.sort();
}

Given('un proyecto con una collection y sus miembros', () => {
  mkdirSync(join(world.root, 'miembros'), { recursive: true });
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG_SELECCION}\n`);
  escribirEnProyecto(
    'index.md',
    [
      '---',
      'title: Antología',
      'type: collection',
      'collectionCreator: Ana García',
      'files:',
      '  - cap1.md',
      '  - miembros/mem.md',
      '---',
      '',
      'Índice.',
      '',
    ].join('\n'),
  );
  escribirEnProyecto('cap1.md', '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido.\n');
  escribirEnProyecto('miembros/mem.md', '---\ntitle: Miembro\ncreator: Bruno Díaz\n---\n\nMiembro.\n');
  escribirEnProyecto('ana.md', '---\ntype: creator\nname: Ana García\n---\n\nEscritora.\n');
  escribirEnProyecto('suelto.md', '---\ntitle: Suelto\ncreator: Bruno Díaz\n---\n\nSuelto.\n');
});

Given('un proyecto con una collection dentro de files[] de otra', () => {
  mkdirSync(join(world.root, 'miembros'), { recursive: true });
  mkdirSync(join(world.root, 'sub'), { recursive: true });
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG_SELECCION}\n`);
  escribirEnProyecto(
    'index.md',
    [
      '---',
      'title: Antología',
      'type: collection',
      'collectionCreator: Ana García',
      'files:',
      '  - cap1.md',
      '  - miembros/mem.md',
      '  - sub/coleccion.md',
      '---',
      '',
      'Índice.',
      '',
    ].join('\n'),
  );
  escribirEnProyecto('cap1.md', '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido.\n');
  escribirEnProyecto('miembros/mem.md', '---\ntitle: Miembro\ncreator: Bruno Díaz\n---\n\nMiembro.\n');
  escribirEnProyecto('ana.md', '---\ntype: creator\nname: Ana García\n---\n\nEscritora.\n');
  escribirEnProyecto('suelto.md', '---\ntitle: Suelto\ncreator: Bruno Díaz\n---\n\nSuelto.\n');
  escribirEnProyecto('sub/coleccion.md', '---\ntype: collection\nfiles:\n  - ../suelto.md\n---\n');
});

async function buildMidiendo(opciones: Parameters<typeof runBuild>[1]): Promise<{ codigo: number; stderr: string }> {
  const espia = spyOn(process.stderr, 'write');
  let stderr = '';
  let codigo = 0;
  process.exitCode = 0;
  try {
    await runBuild(world.root, opciones);
  } catch {
  } finally {
    stderr = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockRestore();
    codigo = process.exitCode;
    process.exitCode = 0;
  }
  return { codigo, stderr };
}

When('hago un build de los paths indicados esperando error', async () => {
  const r = await buildMidiendo({ only: world.pathsSeleccion as string[] });
  world.codigoBuild = r.codigo;
  world.stderrBuild = r.stderr;
});

When('hago un build completo con {string} esperando error', async (opcion: string) => {
  const r = await buildMidiendo(opcion === 'full' ? { full: true, only: world.pathsSeleccion as string[] } : {});
  world.codigoBuild = r.codigo;
  world.stderrBuild = r.stderr;
});

Given('que ya hice un build completo con éxito', async () => {
  const r = await buildMidiendo({});
  if (r.codigo !== 0) throw new Error(`el build de referencia falló: ${r.stderr}`);
  world.distReferencia = mapaDeDist(world.root);
});

Then('el código de salida del build es {int}', (codigo: string) => {
  if (world.codigoBuild !== Number(codigo)) {
    throw new Error(`el código es ${world.codigoBuild} y el escenario dice ${codigo}`);
  }
});

Then('el aviso del build dice {string}', (texto: string) => {
  const salida = String(world.stderrBuild);
  if (!salida.includes(texto)) throw new Error(`el error no dice ${JSON.stringify(texto)}. Dice:\n${salida}`);
});

Then('las salidas de documento son:', (esperadas: string) => {
  const leidas = documentales().join('\n');
  const queridas = esperadas
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  if (leidas !== queridas) {
    throw new Error(`son\n${leidas}\ny deberían ser\n${queridas}`);
  }
});

When('hago un build de los paths indicados en JSON', async () => {
  const espia = spyOn(process.stdout, 'write');
  let crudo = '';
  process.exitCode = 0;
  try {
    await runBuild(world.root, { only: world.pathsSeleccion as string[], json: true });
  } finally {
    crudo = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockRestore();
    process.exitCode = 0;
  }
  const lineas = crudo
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '');
  world.jsonBuild = JSON.parse(lineas[0] ?? '{}') as Record<string, unknown>;
});

Then('las claves del JSON son {string}', (esperadas: string) => {
  const leidas = Object.keys(world.jsonBuild).sort().join(', ');
  if (leidas !== esperadas) {
    throw new Error(`son ${JSON.stringify(leidas)} y deberían ser ${JSON.stringify(esperadas)}`);
  }
});

Then('el JSON declara la selección {string}', (esperado: string) => {
  const seleccion = world.jsonBuild.selected as string[] | undefined;
  const leida = (seleccion ?? []).join(', ');
  if (leida !== esperado) throw new Error(`selected es ${JSON.stringify(leida)} y debería ser ${JSON.stringify(esperado)}`);
});
