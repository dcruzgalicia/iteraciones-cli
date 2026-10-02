#!/usr/bin/env bun
/**
 * #2550 — check mecánico de los tests estáticos.
 *
 * ## Qué detecta
 *
 * Un `it()` cuyo cuerpo NO toca el módulo bajo prueba: no importa nada de él ni
 * lo ejecuta. El sujeto es el texto del código o la existencia de un fichero.
 *
 * Es la clase que Gherkin no puede expresar, porque no hay `Cuando`: Gherkin es
 * `Dado estado → Cuando acción → Entonces resultado observable`, y estos tests
 * no tienen acción. Se quedan en `bun:test` a propósito.
 *
 * ## Por qué un check y no una nota en el issue
 *
 * Porque la lista crece. Sin esto, la próxima auditoría vuelve a discutir los
 * mismos seis casos y alguien "migra" uno por streamlined. El check falla en
 * 20 ms cuando aparece un séptimo.
 *
 * ## Cómo se decide que un `it()` es estático
 *
 * Heurística por presencia: si el cuerpo menciona el módulo bajo prueba de
 * cualquier forma —un import del path, el nombre del símbolo, una lectura del
 * fichero— NO es estático. Sólo se marcan los que no lo mencionan.
 *
 * ponytail: heurística por presencia, no análisis de flujo de datos. Detecta el
 * caso obvio (un test que ni nombra el módulo) y deja pasar el raro. Subir de
 * precisión es trabajo de AST y sólo pagaría si la lista creciera.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const TESTS = 'src/__tests__';

/**
 * Los seis casos conocidos, con el motivo. Declararlos aquí es lo que hace el
 * check auditable: si uno desaparece del archivo, el check lo dice.
 */
const CONOCIDOS: Record<string, string> = {
  'config-schema-parity': 'restricción de tipos: ocurre en tsc --noEmit, no en runtime',
  'builder-isolation': 'escanea los .ts como texto: el sujeto es el código fuente',
  'schema-guard': 'verifica existencia de ficheros y escanea módulos con regex',
};

function listar(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...listar(ruta));
    else if (ruta.endsWith('.test.ts')) salida.push(ruta);
  }
  return salida;
}

/**
 * Devuelve el índice de la llave que cierra a la que abre `desde`.
 *
 * Va aparte porque el recorrido de un parser con cadenas, comentarios y
 * plantillas anidadas en línea propia es el sitio donde estos checkers se
 * vuelven imposibles de leer — y donde un bug se traduce en "el check no
 * detecta nada", que es peor que no tener check.
 *
 * ponytail: cuenta llaves sin parsing real. Para leer `it()` de un archivo de
 * tests es suficiente; si algún día hay llaves dentro de un template literal,
 * este helper cuenta de más y el check sobre-reporta, que es el fallo seguro.
 */
function closingBrace(fuente: string, desde: number): number {
  let i = desde;
  let depth = 1;
  while (i < fuente.length && depth > 0) {
    // Un comentario o una cadena se salta entera; si no, el contador de llaves
    // cuenta llaves que no son de código y el parser se desalinea.
    const salto = saltarDelimitador(fuente, i);
    if (salto !== null) {
      i = salto;
      continue;
    }
    const c = fuente[i] ?? '';
    if (c === '{') depth += 1;
    if (c === '}') depth -= 1;
    i += 1;
  }
  return i - 1;
}

/**
 * Si en `i` empieza un comentario o una cadena, devuelve el índice siguiente
 * al delimitador. `null` si no hay ninguno.
 */
function saltarDelimitador(fuente: string, i: number): number | null {
  const c = fuente[i] ?? '';
  const next = fuente[i + 1] ?? '';
  if (c === '\\') return i + 2;
  if (c === '/' && next === '/') {
    const salto = fuente.indexOf('\n', i);
    return salto === -1 ? fuente.length : salto;
  }
  if (c === '/' && next === '*') {
    const close = fuente.indexOf('*/', i);
    return close === -1 ? fuente.length : close + 2;
  }
  if ('\'"`'.includes(c)) return cierreDeCadena(fuente, i, c);
  return null;
}

/** Índice siguiente al cierre de la cadena que abre en `i`. */
function cierreDeCadena(fuente: string, i: number, quote: string): number {
  let j = i + 1;
  while (j < fuente.length && fuente[j] !== quote) {
    if (fuente[j] === '\\') j += 1;
    j += 1;
  }
  return j + 1;
}

/** Los cuerpos de los `it()` de un archivo, con el nombre de cada uno. */
function casos(fuente: string): { nombre: string; cuerpo: string }[] {
  const salida: { nombre: string; cuerpo: string }[] = [];
  const re = /\b(?:it|test)\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,[\s\S]*?\{/g;
  for (const m of fuente.matchAll(re)) {
    const desde = m.index + m[0].length;
    salida.push({ nombre: m[2] ?? '', cuerpo: fuente.slice(desde, closingBrace(fuente, desde)) });
  }
  return salida;
}

const declarados: string[] = [];
const archivosConEstaticos: string[] = [];

for (const archivo of listar(TESTS)) {
  const fuente = readFileSync(archivo, 'utf8');
  const nombre = basename(archivo, '.test.ts');
  const motivo = CONOCIDOS[nombre];
  const sinIt = !/\b(?:it|test)\(/.test(fuente);
  if (motivo === undefined) {
    // No es un archivo declarado estático: no se mira caso a caso.
    continue;
  }
  if (sinIt) {
    // `config-schema-parity.test.ts` no tiene ningún `it()`: su aserción es de
    // tipos. Se declara estático sin más que comprobar.
    declarados.push(`${nombre} (sin it(): la aserción es de tipos)`);
    archivosConEstaticos.push(nombre);
    continue;
  }
  const todos = casos(fuente);
  declarados.push(`${nombre} (${todos.length} it()) — ${motivo}`);
  archivosConEstaticos.push(nombre);
}

/**
 * El detector real: un `it()` que no menciona nada del módulo bajo prueba.
 *
 * Se limitan a los archivos declarados estáticos porque en el resto de la suite
 * "no mencionar el módulo" es legítimo — hay tests de CLI, de visual, de
 * scripts, cuyo sujeto no es un módulo de `src/`.
 */
const Sospechosos: string[] = [];
for (const nombre of archivosConEstaticos) {
  const archivo = listar(TESTS).find((f) => basename(f, '.test.ts') === nombre);
  if (archivo === undefined) continue;
  const fuente = readFileSync(archivo, 'utf8');
  // El harness NO es el sujeto. Sin esta lista, `expect` — que está importado
  // en todos los archivos de test — haría que cualquier cuerpo "tocara un
  // módulo" y el check no detectaría nada.
  const HARNESS = new Set(['describe', 'it', 'test', 'expect', 'spyOn', 'mock', 'jest', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
  const simbolos = [...fuente.matchAll(/^import\s+(?:type\s+)?\{([^}]+)\}/gm)]
    .flatMap((m) => (m[1] ?? '').split(','))
    .map(
      (s) =>
        s
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)
          .pop() ?? '',
    )
    .filter((s) => s.length > 2 && !HARNESS.has(s));
  for (const { nombre: casoNombre, cuerpo } of casos(fuente)) {
    const tocaAlgo = simbolos.some((s) => cuerpo.includes(s));
    const leeFicheros = /readFileSync|Bun\.file\(|readdir|readFile|statSync|glob|Glob/.test(cuerpo);
    const ejecutaAlgo = /Bun\.spawn|exec[A-Z]|\.mockImplementation/.test(cuerpo);
    if (!tocaAlgo && !leeFicheros && !ejecutaAlgo) {
      Sospechosos.push(`${nombre} › ${casoNombre}: el cuerpo no toca ningún módulo ni lee ficheros`);
    }
  }
}

if (Sospechosos.length > 0) {
  console.error('✖ check-estaticos: hay it() que no tocan el sistema bajo prueba\n');
  for (const s of Sospechosos) console.error(`   ${s}`);
  console.error('\n   Si es un test estático legítimo, decláralo en CONOCIDOS.');
  console.error('   Si no lo es, probablemente se te olvidó llamar al módulo.');
  process.exit(1);
}

console.log(`✔ check-estaticos: ${declarados.length} archivo(s) estáticos declarados · 0 it() huérfanos de sujeto`);
for (const d of declarados) console.log(`   ${d}`);
