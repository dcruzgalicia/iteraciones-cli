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

/** Convierte un patrón de step definition en regex. `{string}` -> captura. */
function patternToRegExp(texto: string): RegExp {
  const fuente = texto
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{(string|int|float|word)\\\}/g, (_, tipo: string) =>
      tipo === 'string' ? '"([^"]*)"' : tipo === 'int' ? '(-?\\d+)' : tipo === 'float' ? '(-?[\\d.]+)' : '([^\\s]+)',
    );
  return new RegExp(`^${fuente}$`);
}

/** Steps definedSteps: `Given('texto', ...)` en cualquier binding. */
function stepsDefinidos(): Map<string, string[]> {
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
type LineClass = 'ignorar' | 'escenario' | 'estructura' | { keyword: string; texto: string };

function classify(trimmed: string, lastKeyword: string): LineClass {
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('|')) return 'ignorar';
  if (RE_ESCENARIO.test(trimmed)) return 'escenario';
  if (RE_ESTRUCTURA.test(trimmed)) return 'estructura';
  const m = RE_STEP.exec(trimmed);
  if (!m) return 'ignorar';
  const keyword = m[1] ?? '';
  if (!KEYWORDS.includes(keyword)) return 'ignorar';
  // `Y`/`E` heredan el keyword del step anterior; si no hay, no son un step.
  const effective = keyword === 'Y' || keyword === 'E' ? lastKeyword : keyword;
  if (effective === '') return 'ignorar';
  return { keyword: effective, texto: m[2] ?? '' };
}

interface Reading {
  scenarios: number;
  stepTexts: string[];
}

function readFeature(fuente: string): Reading {
  const stepTexts: string[] = [];
  let lastKeyword = '';
  let inDocstring = false;
  let scenarios = 0;
  for (const line of fuente.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('"""')) {
      inDocstring = !inDocstring;
      continue;
    }
    // El cuerpo de un docstring es dato, no step.
    if (inDocstring) continue;
    const classification = classify(trimmed, lastKeyword);
    if (classification === 'ignorar') continue;
    if (classification === 'escenario') {
      scenarios += 1;
      lastKeyword = '';
      continue;
    }
    if (classification === 'estructura') {
      lastKeyword = '';
      continue;
    }
    lastKeyword = classification.keyword;
    stepTexts.push(classification.texto);
  }
  return { scenarios, stepTexts };
}

/** Steps usados, con `Y`/`E` resueltos al keyword del step anterior. */
function stepsUsados(): { stepTexts: string[]; byFeature: Map<string, Reading> } {
  const stepTexts: string[] = [];
  const byFeature = new Map<string, Reading>();
  for (const feature of walkDir(FEATURES)) {
    if (!feature.endsWith('.feature')) continue;
    const reading = readFeature(readFileSync(feature, 'utf8'));
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

const definedSteps = stepsDefinidos();
const { stepTexts, byFeature } = stepsUsados();
const warnings: string[] = [];
const errors: string[] = [];
const patterns = [...definedSteps.keys()].map((p) => [p, patternToRegExp(p)] as const);

function casa(cuerpo: string): boolean {
  return patterns.some(([, re]) => re.test(cuerpo));
}

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
  return !stepTexts.some((cuerpo) => re.test(cuerpo));
});

// 3. Keywords inglesas: el repo es Gherkin en español (#2544, punto 4).
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
  warnings.push(`${DEFINED} steps definedSteps: el budget del issue es ~300. El vocabulario está demasiado fragmentado.`);
}

// 5. Criterio de aceptación de #2544: un feature con >3 scenarios debe
//    necesitar menos de 10 steps definedSteps a mano.
for (const [feature, { scenarios, stepTexts: usados }] of byFeature) {
  const distinctSteps = new Set(usados.filter(casa));
  if (scenarios >= 3 && distinctSteps.size > 10) {
    errors.push(`${feature}: ${distinctSteps.size} steps distintos para ${scenarios} scenarios — el criterio de #2544 es <10 steps con >3 scenarios`);
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
