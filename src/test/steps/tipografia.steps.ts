import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { analyzePdf, analyzeText, splitPages, type TypographyIncidence } from '../../lib/pdf-typography.js';
import { pdfDePaginas } from '../helpers/pdf.ts';
import { escribirEnProyecto, jsonSalida, world } from './cli-world.steps.ts';

const RAIZ = join(import.meta.dir, '..', '..', '..');

/**
 * Un docstring con líneas "\f" se convierte en la salida que arma pdftotext: cada página cierra
 * con su salto de línea, el \f va pegado a la línea que abre la siguiente, y hay un \f final que
 * cierra el documento. Armarla aquí (y no en el escenario) deja el fixture con la forma real.
 */
function salidaPdftotext(texto: string): string {
  const paginas = texto.split(/\\f\n?/).map((pagina) => pagina.trimEnd());
  return `${paginas.map((pagina) => (pagina === '' ? '' : `${pagina}\n`)).join('\f')}\f`;
}

function describe(incidencia: TypographyIncidence): string {
  if (incidencia.type === 'single-word-line') {
    return `single-word-line ;; pág ${incidencia.page} ;; línea ${incidencia.line} ;; ${incidencia.text.trim()}`;
  }
  const numeros = incidencia.lineas.map((l) => l.line);
  const rango = `líneas ${numeros[0]}-${numeros.at(-1)}${incidencia.total > incidencia.lineas.length ? ` de ${incidencia.total}` : ''}`;
  const cuerpo = incidencia.lineas.map((l) => `${l.line}: ${l.text.trim()}`).join(' || ');
  const letra = incidencia.type === 'consecutive-punctuation' ? '' : ` ;; ${incidencia.letter}`;
  return `${incidencia.type} ;; pág ${incidencia.page} ;; ${rango}${letra} ;; ${cuerpo}`;
}

function renglones(texto: string): string {
  return texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .join('\n');
}

Given('que pdftotext devuelve:', (texto: string) => {
  world.textoPdftotext = salidaPdftotext(texto);
});

Given('que pdftotext devuelve una salida sin el salto final:', (texto: string) => {
  world.textoPdftotext = texto.replace(/\\f\n?/g, '\f');
});

When('escaneo el texto de pdftotext', () => {
  world.incidencias = analyzeText(world.textoPdftotext).map(describe);
});

// Los escenarios que comprueban qué signos disparan la regla usan líneas de dos palabras,
// donde el ancho de referencia es el de esas mismas líneas; sin apagar el filtro de ancho
// se medirían contra sí mismas y no probarían nada.
When('escaneo el texto de pdftotext sin el filtro de línea corta', () => {
  world.incidencias = analyzeText(world.textoPdftotext, { porcentajeCorta: 0, lineasMinimas: 2, letrasMinimas: 1 }).map(describe);
});

When('escaneo el texto de pdftotext buscando {string} sin el filtro de línea corta', (reglas: string) => {
  const pedidas = reglas.split(',').map((r) => r.trim());
  world.incidencias = analyzeText(world.textoPdftotext, { porcentajeCorta: 0, lineasMinimas: 2, letrasMinimas: 1 })
    .filter((incidencia) => pedidas.includes(incidencia.type))
    .map(describe);
});

When('escaneo el texto de pdftotext con {int} lineas y {int} letras', (lineas: number, letras: number) => {
  world.incidencias = analyzeText(world.textoPdftotext, {
    porcentajeCorta: 0,
    lineasMinimas: lineas,
    letrasMinimas: letras,
  }).map(describe);
});

When('escaneo el texto de pdftotext buscando {string}', (reglas: string) => {
  const pedidas = reglas.split(',').map((r) => r.trim());
  world.incidencias = analyzeText(world.textoPdftotext, { lineasMinimas: 2, letrasMinimas: 1 })
    .filter((incidencia) => pedidas.includes(incidencia.type))
    .map(describe);
});

Given('el PDF {string} con estas páginas:', (nombre: string, texto: string) => {
  escribirEnProyecto(nombre, '');
  // El PDF de las fixtures no lleva codificación de fuente: el texto va en ASCII.
  writeFileSync(join(world.root, nombre), pdfDePaginas(splitPages(salidaPdftotext(texto))));
});

When('escaneo el PDF {string}', async (nombre: string) => {
  await escaneaPdf(nombre, 75);
});

When('escaneo el PDF {string} sin el filtro de línea corta', async (nombre: string) => {
  await escaneaPdf(nombre, 0);
});

When('escaneo el PDF {string} buscando {string}', async (nombre: string, reglas: string) => {
  const pedidas = reglas.split(',').map((r) => r.trim());
  await escaneaPdf(nombre, 0, pedidas);
});

async function escaneaPdf(nombre: string, porcentajeCorta: number, reglas?: string[]): Promise<void> {
  world.incidencias = [];
  world.errMensaje = '';
  world.errClase = '';
  try {
    const halladas = await analyzePdf(join(world.root, nombre), {
      porcentajeCorta,
      lineasMinimas: 2,
      letrasMinimas: 1,
    });
    world.incidencias = (reglas ? halladas.filter((i) => reglas.includes(i.type)) : halladas).map(describe);
  } catch (err) {
    world.errMensaje = err instanceof Error ? err.message : String(err);
    world.errClase = err instanceof Error ? err.constructor.name : typeof err;
  }
}

When('corro el binario sin pdftotext en el PATH para {string}', async (argumentos: string) => {
  const proc = Bun.spawn([process.execPath, 'src/bin.ts', ...argumentos.split(' ').filter(Boolean), '--project-root', world.root], {
    cwd: RAIZ,
    env: { ...process.env, PATH: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  world.stdout = await new Response(proc.stdout).text();
  world.stderr = await new Response(proc.stderr).text();
  world.exitCode = await proc.exited;
});

Then('las incidencias son:', (esperado: string) => {
  const leido = world.incidencias.join('\n');
  const pedido = renglones(esperado);
  if (leido !== pedido) {
    throw new Error(`las incidencias son\n${leido}\ny debían ser\n${pedido}`);
  }
});

Then('no hay incidencias', () => {
  if (world.incidencias.length > 0) {
    throw new Error(`hay incidencias: ${world.incidencias.join(' / ')}`);
  }
});

Then('el escaneo falla con {string} diciendo {string}', (clase: string, motivo: string) => {
  if (world.errClase !== clase) {
    throw new Error(`falló con ${JSON.stringify(world.errClase)} y debía fallar con ${JSON.stringify(clase)}`);
  }
  if (!world.errMensaje.includes(motivo)) {
    throw new Error(`el error no dice ${JSON.stringify(motivo)}. Dice: ${JSON.stringify(world.errMensaje)}`);
  }
});

Then('el JSON del typography es:', (esperado: string) => {
  const leido = JSON.stringify(JSON.parse(world.stdout));
  const pedido = renglones(esperado);
  if (leido !== pedido) {
    throw new Error(`el JSON es\n${leido}\ny debía ser\n${pedido}`);
  }
});

Then('el JSON del typography declara que todo está bien', () => {
  const salida = jsonSalida();
  if (salida.ok !== true) {
    throw new Error(`ok es ${JSON.stringify(salida.ok)} y debía ser verdadero`);
  }
});
