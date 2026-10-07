import { spyOn } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import {
  computeProcessTargets,
  imageNamerFor,
  imagePathsMap,
  processDocumentImages,
  resetMagickCache,
  rewriteImagePaths,
  scanInlineImages,
  scanTitlePageFieldImages,
} from '../../builder/image-processor.js';
import { world } from './cli-world.steps.ts';

const DIR_DOC = '/proyecto/capitulos';
const PROCESADA = '/proyecto/capitulos/.iteraciones/processed-images/img.jpg';

Given('que la imagen del documento se procesó en {string}', (destino: string) => {
  world.mapaImagenes = new Map([[`${DIR_DOC}/img.png`, destino]]);
});

Given('que el mapa de imágenes está vacío', () => {
  world.mapaImagenes = new Map();
});

Given('que hay una imagen que no se procesó', () => {
  world.mapaImagenes = new Map([[`${DIR_DOC}/img.png`, PROCESADA]]);
  world.imagenSinProcesar = `${DIR_DOC}/gif.png`;
});

Given('que sólo hay una imagen que no se procesó', () => {
  world.mapaImagenes = new Map([[`${DIR_DOC}/gif.png`, `${DIR_DOC}/gif.png`]]);
});

Given('que hay una imagen procesada fuera del directorio del documento', () => {
  world.mapaImagenes = new Map([['/proyecto/comun/x.png', '/salida/assets/images/cap-x.jpg']]);
});

When('reescribo las rutas de imagen del contenido:', (contenido: string) => {
  world.contenido = rewriteImagePaths(contenido.replace(/<br>/g, '\n'), new Map(world.mapaImagenes), DIR_DOC);
});

Then('el contenido reescrito dice {string}', (texto: string) => {
  if (!world.contenido.includes(texto)) throw new Error(`el contenido no dice ${JSON.stringify(texto)}:\n${world.contenido}`);
});

Then('el contenido reescrito es:', (esperado: string) => {
  const quiere = esperado.replace(/<br>/g, '\n');
  if (world.contenido !== quiere) {
    throw new Error(`el contenido es ${JSON.stringify(world.contenido)} y debería ser ${JSON.stringify(quiere)}`);
  }
});

When('expongo el mapa de rutas para {string}', (formato: string) => {
  world.rutas = imagePathsMap(new Map(world.mapaImagenes), DIR_DOC, formato === 'html');
});

Then('la ruta {string} vale {string}', (ruta: string, valor: string) => {
  const leido = (world.rutas as Record<string, string>)[ruta];
  if (leido !== valor) {
    throw new Error(`la ruta ${ruta} vale ${JSON.stringify(leido)} y debería ser ${JSON.stringify(valor)}`);
  }
});

Then('el mapa de rutas está vacío', () => {
  if (Object.keys(world.rutas as Record<string, string>).length !== 0) {
    throw new Error(`esperaba un mapa vacío y salió ${JSON.stringify(world.rutas)}`);
  }
});

Given('nombro las imágenes con el prefijo {string}', (prefijo: string) => {
  world.namer = imageNamerFor(prefijo);
  world.nombreActual = '';
});

When('nombro la imagen {string}', (ruta: string) => {
  world.nombreActual = (world.namer as (ruta: string) => string)(ruta);
});

Then('el nombre es {string}', (esperado: string) => {
  if (world.nombreActual !== esperado) {
    throw new Error(`el nombre es ${JSON.stringify(world.nombreActual)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

When('escaneo las imágenes en línea de:', (contenido: string) => {
  world.enLinea = scanInlineImages(contenido.replace(/<br>/g, '\n'), DIR_DOC);
});

Then('las imágenes en línea son {string}', (esperadas: string) => {
  const leidas = world.enLinea.join(', ');
  if (leidas !== esperadas) {
    throw new Error(`escaneé ${JSON.stringify(leidas)} y esperaba ${JSON.stringify(esperadas)}`);
  }
});

Given('que el frontmatter declara el campo {string} con:', (campo: string, valor: string) => {
  const multilinea = valor.replace(/<br>/g, '\n').trim();
  world.camposPortada = { ...world.camposPortada, [campo]: multilinea.startsWith('[') ? JSON.parse(multilinea) : multilinea };
});

Given('que el proyecto tiene la imagen {string}', (ruta: string) => {
  const destino = `${world.root}/${ruta}`;
  mkdirSync(dirname(destino), { recursive: true });

  writeFileSync(destino, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
});

When('escaneo las imágenes de los campos de portada', async () => {
  world.portada = await scanTitlePageFieldImages(world.camposPortada as Record<string, unknown>, world.root);
});

Then('el escaneo de portada encuentra {int} imágenes', (cuantas: number) => {
  if (world.portada.length !== cuantas) {
    throw new Error(`encontró ${world.portada.length} y son ${cuantas}: ${JSON.stringify(world.portada)}`);
  }
});

Then('la imagen {int} de portada es {string}', (cual: number, ruta: string) => {
  const absPath = world.portada[cual - 1]?.absPath ?? '';
  if (!absPath.endsWith(ruta)) {
    throw new Error(`la imagen ${cual} es ${JSON.stringify(absPath)} y debería acabar en ${ruta}`);
  }
});

Then('la imagen {int} de portada no es SVG', (cual: number) => {
  if (world.portada[cual - 1]?.isSvg) throw new Error(`la imagen ${cual} es SVG y no debía`);
});

When('proceso un documento sin ImageMagick', async () => {
  resetMagickCache();
  const espia = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await processDocumentImages(
      [],
      {},
      world.root,
      { w: 100, h: 150, textW: 80 },
      false,
      join(world.root, 'out'),
      imageNamerFor('doc'),
      undefined,
      world.pdfxActivo === true,
      async () => false,
    );
    world.stderr = espia.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    espia.mockRestore();
    resetMagickCache();
  }
});

When('proceso dos documentos sin ImageMagick', async () => {
  resetMagickCache();
  const espia = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    for (const _ of [1, 2]) {
      await processDocumentImages(
        [],
        {},
        world.root,
        { w: 100, h: 150, textW: 80 },
        false,
        join(world.root, 'out'),
        imageNamerFor('doc'),
        undefined,
        world.pdfxActivo === true,
        async () => false,
      );
    }
    world.stderr = espia.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    espia.mockRestore();
    resetMagickCache();
  }
});

Then('el aviso de ImageMagick aparece {int} vez', (veces: number) => {
  const encontradas = (world.stderr.match(/ImageMagick no disponible/g) ?? []).length;
  if (encontradas !== veces) {
    throw new Error(`el aviso salió ${encontradas} veces y son ${veces}: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el aviso menciona la certificación', () => {
  if (!world.stderr.includes('pueden fallar la certificación PDF/X')) {
    throw new Error(`el aviso no menciona la certificación: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el aviso no menciona la certificación', () => {
  if (world.stderr.includes('certificación PDF/X')) {
    throw new Error(`el aviso menciona la certificación y no debía: ${JSON.stringify(world.stderr)}`);
  }
});

Given('que la página es de {int} por {int} con {int} de texto', (w: number, h: number, textW: number) => {
  world.pagina = { w, h, textW };
});

When('calculo las cajas de destino {string}', (crop: string) => {
  world.cajas = computeProcessTargets(world.pagina as { w: number; h: number; textW: number }, crop === 'con crop');
});

Given('que el aviso de ImageMagick se da por activo', () => {
  world.pdfxActivo = true;
});

Given('que el aviso de ImageMagick se da por inactivo', () => {
  world.pdfxActivo = false;
});

Then('la caja de destino cabe {string}', (medida: string) => {
  const [w, h] = medida.split('x').map(Number);
  const t = world.cajas as { targetW: number; targetH: number };
  if (Math.round(t.targetW) !== w || Math.round(t.targetH) !== h) {
    throw new Error(`la caja es ${Math.round(t.targetW)}x${Math.round(t.targetH)} y debería ser ${medida}`);
  }
});

Then('la caja del startpaper cabe {string}', (medida: string) => {
  const [w, h] = medida.split('x').map(Number);
  const t = world.cajas as { startpaperW: number; startpaperH: number };
  if (Math.round(t.startpaperW) !== w || Math.round(t.startpaperH) !== h) {
    throw new Error(`la del startpaper es ${Math.round(t.startpaperW)}x${Math.round(t.startpaperH)} y debería ser ${medida}`);
  }
});
