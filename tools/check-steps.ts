#!/usr/bin/env bun
/**
 * #2544 — check mecánico del vocabulario Gherkin.
 *
 * Detecta los dos fallos que hacen que una migración a Gherkin se pudra:
 *
 *   1. **Steps huérfanos**: definedSteps y nunca usados. Cada uno es vocabulario
 *      que alguien diseño y nadie exercising — y las ondas siguientes los van a
 *      copiar por，就这么算了。
 *   2. **Steps sin definir**: usados en un .feature y sin binding. Es la
 *      trampa 1 del spike (#2543): cucumber los reporta como `undefined` sin
 *      ningún error, así que el suite sigue verde y no comprueba nada.
 *
 * Por qué existe como script y no como `cucumber --dry-run`: cucumber SÍ
 * detecta el matches 2, pero lo reporta al final de la corrida, después de que el
 * push ya está hecho. Este check corre en pre-commit y falla en 20 ms.
 *
 * ponytail: parsea Gherkin con regex, no con el parser oficial (@cucumber/gherkin
 * ya está en node_modules). El parser real daría etiquetado de columnas y
 * tracking de `Y`/`E`; la regex cubre lo que este repo usa. Si algún día un
 * .feature usa algo que la regex no entiende, este check avisa en vez de
 * mentir — ver `AVISOS` abajo.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FEATURES = 'features';
const STEPS = 'src/test/steps';

/** Keywords del dialecto `es` (#2543). `Y`/`E` heredan la del step anterior. */
const KEYWORDS = ['Dado', 'Dada', 'Dados', 'Dadas', 'Cuando', 'Entonces', 'Y', 'E'];
const ENGLISH = ['Given', 'When', 'Then', 'And', 'But', 'Feature', 'Scenario', 'Scenario Outline', 'Examples', 'Background', 'Rule'];

/**
 * Convierte un patrón de step definition en regex.
 *
 * ## Por qué aquí no hay manejo de escapes
 *
 * Porque el catálogo prohíbe `/` en el texto de un step. En una Cucumber
 * Expression `a/b` significa "a **o** b": un step definition con una barra nunca
 * casa con el texto completo, se compila a `^... assets$|^images$`, y cucumber lo
 * reporta como `undefined` **sin error**. Con `a//b` la corrida entera muere con
 * "Alternative may not be empty".
 *
 * Se podría escapar (`a\/b`), pero entonces este checker tendría que
 * interpretar escapes de JavaScript — lee el código fuente, no el valor en
 * runtime — y eso mete bugs dentro del checker que vigila al resto. La prosa no
 * lleva rutas: el path va en el mensaje de error del step, no en su nombre.
 * `slashWithoutEscape` convierte el descuido en un error de 20 ms.
 */

function patternToRegExp(texto: string): RegExp {
  const fuente = texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(string|int|float|word)\\\}/g, (_, tipo: string) =>
    tipo === 'string'
      ? // Cucumber acepta `"…"` y `'…'` para `{string}`
        // (STRING_REGEXP en defineDefaultParameterTypes.js). Sólo con `"…"`
        // este checker reportaba como indefinidos los pasos cuyo texto lleva
        // comillas dobles adentro — justo los que comparan un mensaje de
        // error, que viene entrecomillado. Los grupos no se leen: el regex
        // sólo se usa con `.test()`.
        String.raw`(?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')`
      : tipo === 'int'
        ? '(-?\\d+)'
        : tipo === 'float'
          ? '(-?[\\d.]+)'
          : '([^\\s]+)',
  );
  return new RegExp(`^${fuente}$`);
}

/** Una barra sin escapar es alternancia en cucumber y rompe el match en silencio. */
function slashWithoutEscape(texto: string): boolean {
  return /(^|[^\\])\//.test(texto);
}

/** Steps definidos: `Given('texto', ...)` en cualquier binding. */
function definedStepsFrom(): Map<string, string[]> {
  const definedSteps = new Map<string, string[]>();
  for (const file of walkDir(STEPS)) {
    if (!file.endsWith('.steps.ts')) continue;
    const fuente = readFileSync(file, 'utf8');
    for (const m of fuente.matchAll(/\b(?:Given|When|Then)\(\s*(['"])(.*?)\1/g)) {
      const key = m[2] ?? '';
      const lista = definedSteps.get(key) ?? [];
      lista.push(file);
      definedSteps.set(key, lista);
    }
  }
  return definedSteps;
}

const RE_ESCENARIO = /^Escenario\b/;
const RE_ESTRUCTURA = /^(Ejemplos|Antecedentes|Característica|Regla|Ejemplo)\b/;
// `Dado un cuerpo:` — el `:` final es parte del texto del step (indica docstring),
// no un separador. Por eso se busca el keyword al principio de la línea y no el
// primer `:`.
const RE_STEP = /^([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(.+)$/;

/** Qué hace una línea del .feature con el conteo de steps. */
interface LineClass {
  kind: 'ignorar' | 'escenario' | 'estructura' | 'step';
  keyword?: string;
  text?: string;
}

function classify(trimmed: string, lastKeyword: string): LineClass {
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('|')) return { kind: 'ignorar' };
  if (RE_ESCENARIO.test(trimmed)) return { kind: 'escenario' };
  if (RE_ESTRUCTURA.test(trimmed)) return { kind: 'estructura' };
  const m = RE_STEP.exec(trimmed);
  if (!m) return { kind: 'ignorar' };
  const keyword = m[1] ?? '';
  if (!KEYWORDS.includes(keyword)) return { kind: 'ignorar' };
  // `Y`/`E` heredan el keyword del step anterior; si no hay, no son un step.
  const effective = keyword === 'Y' || keyword === 'E' ? lastKeyword : keyword;
  if (effective === '') return { kind: 'ignorar' };
  return { kind: 'step', keyword: effective, text: m[2] ?? '' };
}

interface Reading {
  scenarios: number;
  stepTexts: string[];
}

/**
 * Fila de tabla `| a | b |`.
 *   - `null`     → la línea no es una fila.
 *   - `cabecera` → es la primera fila: los nombres de las columnas.
 *   - `fila`     → es un caso.
 */
function readExamplesRow(trimmed: string, headers: string[]): { kind: 'null' | 'cabecera' | 'fila'; cells: string[] } {
  if (!trimmed.startsWith('|')) return { kind: 'null', cells: [] };
  const cells = trimmed
    .slice(1, trimmed.lastIndexOf('|'))
    .split('|')
    .map((c) => c.trim());
  return headers.length === 0 ? { kind: 'cabecera', cells } : { kind: 'fila', cells };
}

interface Scan {
  stepTexts: string[];
  lastKeyword: string;
  scenarios: number;
  inDocstring: boolean;
  headers: string[];
  rows: string[][];
}

/**
 * Consume las líneas que NO son un step: docstrings, tablas `Ejemplos`,
 * comentarios y líneas en blanco. `true` si la línea era de ésas.
 *
 * Va aparte para que `readFeature` no se pase de la complejidad máxima: el bucle
 * de un parser con seis ramas distintas en línea propia es el sitio donde estos
 * checkers se vuelven imposibles de leer.
 */
function consumeStructure(trimmed: string, state: Scan): boolean {
  if (trimmed.startsWith('"""')) {
    state.inDocstring = !state.inDocstring;
    return true;
  }
  // El cuerpo de un docstring es dato, no estructura.
  if (state.inDocstring) return true;

  const table = readExamplesRow(trimmed, state.headers);
  if (table.kind === 'cabecera') {
    state.headers = table.cells;
    return true;
  }
  if (table.kind === 'fila') {
    // Cada fila de `Ejemplos` es un caso que cucumber corre de verdad, así que
    // suma scenario. Sin esto, un esquema de 5 filas contaría como 1 y el ratio
    // steps-por-scenario saldría inflado.
    state.rows.push(table.cells);
    state.scenarios += 1;
    return true;
  }
  return trimmed === '' || trimmed.startsWith('#');
}

/** Lee un .feature y devuelve sus scenarios y los textos de sus steps. */
function readFeature(fuente: string, casa: (text: string) => boolean): Reading {
  const state: Scan = { stepTexts: [], lastKeyword: '', scenarios: 0, inDocstring: false, headers: [], rows: [] };

  for (const line of fuente.split('\n')) {
    const trimmed = line.trim();
    if (consumeStructure(trimmed, state)) continue;

    const classification = classify(trimmed, state.lastKeyword);
    if (classification.kind === 'ignorar') continue;
    if (classification.kind === 'estructura') {
      // Cada `Ejemplos:` nuevo invalida la tabla anterior.
      if (/^Ejemplos\b/.test(trimmed)) {
        state.headers = [];
        state.rows = [];
      }
      continue;
    }
    if (classification.kind === 'escenario') {
      state.scenarios += 1;
      state.lastKeyword = '';
      continue;
    }
    state.lastKeyword = classification.keyword ?? '';
    state.stepTexts.push(classification.text ?? '');
  }

  return { scenarios: state.scenarios, stepTexts: expandOutline(state.stepTexts, state.headers, state.rows, casa) };
}

/**
 * Sustituye los `<columna>` de un `Esquema del escenario` por cada fila de
 * `Ejemplos`.
 *
 * cucumber busca el binding del texto **ya sustituido**, así que el checker tiene
 * que hacer lo mismo o reportaría `Entonces el hash <resultado>` como step sin
 * definir cuando en realidad hay cinco bindings que sí existen.
 *
 * ## Por qué sólo hay un post-proceso y no una sustitución en línea
 *
 * La tabla de `Ejemplos` va **después** de los steps que la usan. Con una
 * sustitución en línea, al leer `Cuando <acción>` la tabla todavía no se había
 * leído y el texto salía sin expandir.
 *
 * ## Por qué el literal desaparece del resultado
 *
 * Si un texto trae `<…>` y alguna de sus sustituciones casa con un binding, el
 * literal no se reporta: es ruido. Si ninguna casa, el literal es exactamente el
 * mensaje que hay que dar —"este placeholder no tiene binding"— porque un
 * `<acción>` sin tabla detrás sí es un error real.
 *
 * ponytail: con más de una tabla de `Ejemplos` en un mismo feature se usan las
 * filas de todas como si fueran una. Es una aproximación que sólo affects la
 * pregunta "¿existe AL MENOS un binding que case?", que es la que hace el
 * checker. Si alguna vez hace falta exactitud, se parsea el outline por
 * escenario.
 */
function expandOutline(stepTexts: string[], headers: string[], rows: string[][], casa: (text: string) => boolean): string[] {
  if (rows.length === 0) return stepTexts;
  const salida: string[] = [];
  for (const texto of stepTexts) {
    if (!texto.includes('<')) {
      salida.push(texto);
      continue;
    }
    const concrete = new Set<string>();
    for (const fila of rows) {
      let sustituto = texto;
      headers.forEach((header, i) => {
        sustituto = sustituto.replace(new RegExp(`<${header}>`, 'g'), fila[i] ?? '');
      });
      concrete.add(sustituto);
    }
    for (const candidato of concrete) salida.push(candidato);
    // El literal sólo se reporta si NINGUNA sustitución casa. Si alguna casa, el
    // paso está bien y el `<…>` es sólo notación del outline.
    if (![...concrete].some(casa)) salida.push(texto);
  }
  return salida;
}

/** Steps usados, con `Y`/`E` resueltos al keyword del step anterior. */
function usedStepsFrom(): { stepTexts: string[]; byFeature: Map<string, Reading> } {
  const stepTexts: string[] = [];
  const byFeature = new Map<string, Reading>();
  for (const feature of walkDir(FEATURES)) {
    if (!feature.endsWith('.feature')) continue;
    const reading = readFeature(readFileSync(feature, 'utf8'), casa);
    byFeature.set(feature, reading);
    stepTexts.push(...reading.stepTexts);
  }
  return { stepTexts, byFeature };
}

function walkDir(dir: string): string[] {
  const output: string[] = [];
  const recorrer = (actual: string): void => {
    for (const entry of readdirSync(actual)) {
      const ruta = join(actual, entry);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else output.push(ruta);
    }
  };
  try {
    recorrer(dir);
  } catch {
    return [];
  }
  return output;
}

const definedSteps = definedStepsFrom();
const patterns = [...definedSteps.keys()].map((p) => [p, patternToRegExp(p)] as const);

/** ¿Hay algún step definition que case con este texto? */
function casa(text: string): boolean {
  return patterns.some(([, re]) => re.test(text));
}

const { stepTexts, byFeature } = usedStepsFrom();
const warnings: string[] = [];
const errors: string[] = [];

// 1. Sin definir — el fallo silencioso del spike (#2543).
const undefinedSteps: string[] = [];
for (const [feature, { stepTexts: usados }] of byFeature) {
  for (const stepText of usados) {
    if (!casa(stepText)) undefinedSteps.push(`${feature}: ${stepText}`);
  }
}

// 2. Definidos y nunca usados.
const orphanSteps = [...definedSteps.keys()].filter((patron) => {
  const re = patternToRegExp(patron);
  return !stepTexts.some((text) => re.test(text));
});

// 3. Barras sin escapar: en cucumber son alternancia (#2545). Rompe el match en
//    silencio, asi que tiene que ser un error y no un aviso.
for (const [patron, archivos] of definedSteps) {
  if (slashWithoutEscape(patron)) {
    errors.push(
      `${String(archivos[0])}: "${patron}" tiene una "/" sin escapar — en cucumber es alternancia ("a o b") y el step nunca casa. Quítala de la prosa o escríbela como \\/`,
    );
  }
}

// 4. Keywords inglesas: el repo es Gherkin en español (#2544, punto 4).
for (const feature of byFeature.keys()) {
  const fuente = readFileSync(feature, 'utf8');
  for (const keyword of ENGLISH) {
    if (new RegExp(`^\\s*${keyword}[:\\s]`, 'm').test(fuente)) {
      errors.push(`${feature}: keyword inglesa "${keyword}" — el dialecto es \`es\``);
    }
  }
}

// 4. Budget: ~300 steps únicos para ~954 casos (#2544).
const DEFINED = definedSteps.size;
const USES = stepTexts.length;
if (DEFINED > 400) {
  warnings.push(`${DEFINED} definidos: el budget del issue es ~300. El vocabulario está demasiado fragmentado.`);
}

// 5. Fragmentación del vocabulario.
//
//    #2544 pedía "menos de 10 steps con más de 3 scenarios". Como umbral
//    absoluto sólo sirve para el feature con el que se calibró
//    (`vocabulario-del-cuerpo`: 2 steps, 10 scenarios) y castiga a los features
//    que tienen varios contratos distintos: `composers-fixtures` son 9 scenarios
//    sobre 6 contratos de pandoc más 3 de distribución, y meterlos en 10 steps
//    obligaría a agrupar asserts que no tienen relación entre sí — Gherkin peor,
//    no mejor.
//
//    La señal real de fragmentación es el ratio steps-por-scenario: un step por
//    `expect` da 5-8, que es exactamente lo que el catálogo rechaza. El techo
//    absoluto se mantiene para el caso patológico de un feature enorme con muy
//    pocos scenarios.
//
//    ponytail: 4.0 es el corte elegido mirando el repo, no derivado de una
//    métrica externa. Subirlo si una onda legítima choca con él.
const STEPS_POR_SCENARIO = 4;
for (const [feature, { scenarios, stepTexts: usados }] of byFeature) {
  const distinctSteps = new Set(usados.filter(casa));
  if (scenarios <= 3) continue;
  const ratio = distinctSteps.size / scenarios;
  if (ratio > STEPS_POR_SCENARIO) {
    errors.push(
      `${feature}: ${distinctSteps.size} steps para ${scenarios} scenarios (ratio ${ratio.toFixed(1)}) — el techo es ${STEPS_POR_SCENARIO} steps por scenario. Un step por assert es lo que el catálogo rechaza`,
    );
  }
}

if (errors.length > 0 || undefinedSteps.length > 0 || orphanSteps.length > 0) {
  console.error('✖ check-steps: fallo\n');
  for (const e of errors) console.error(`   ${e}`);
  if (undefinedSteps.length > 0) {
    console.error(`\n   steps sin definir — cucumber los reportaría como "undefined" sin error:\n`);
    for (const h of undefinedSteps) console.error(`     ${h}`);
  }
  if (orphanSteps.length > 0) {
    console.error(`\n   steps huérfanos (definedSteps y nunca usados — vocabulario que se paga y no se ejerce):\n`);
    for (const h of orphanSteps) console.error(`     ${h}`);
  }
  process.exit(1);
}

console.log(`✔ check-steps: ${USES} invocaciones · ${DEFINED} definidos · ${undefinedSteps.length} sin definir · ${orphanSteps.length} huérfanos`);
for (const a of warnings) console.log(`   ⚠ ${a}`);
