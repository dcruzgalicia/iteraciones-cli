import { CAPABILITIES, type Capability, SKIP_REASONS, TAG_PREFIX } from './capabilities.js';

/**
 * #2549 — el informe de "lo NO verificado en esta máquina".
 *
 * Contrato copiado del de `bun:test` (`formatSkipReport` en
 * `src/__tests__/helpers.ts`), porque la decisión que hay que conservar es
 * exacta: **la suite nunca falla por entorno ausente, pero toda corrida dice
 * qué no se cubrió.**
 *
 * - stderr al salir, no stdout: no se mezcla con el reporte de cucumber.
 * - agrupado por razón, con los archivos y cuántos escenarios pierde cada uno.
 * - silencioso cuando no hay omitidos.
 *
 * ## Por qué el registro es explícito y no se deduce del filtro
 *
 * cucumber tiene `--tags 'not @requires-pandoc'`, que es un filtro estático y
 * **omite en silencio**. Eso es justo el modo de fallo caro del issue: nadie
 * puede distinguir "no había nada" de "no corrió la mitad". Por eso el recorrido
 * de features se hace ANTES de filtrar, se registra cada descarte, y sólo
 * después se construye el filtro. Si un escenario se descarta, aparece en el
 * informe; si no, no.
 */

/** feature → capability → escenarios descartados por esa capability. */
const registry = new Map<string, Map<Capability, string[]>>();

export function registerOmission(feature: string, capability: Capability, scenario: string): void {
  const perCapability = registry.get(feature) ?? new Map<Capability, string[]>();
  perCapability.set(capability, [...(perCapability.get(capability) ?? []), scenario]);
  registry.set(feature, perCapability);
}

export function resetOmissions(): void {
  registry.clear();
}

/**
 * Reporte agregado. Puro: recibe el registro, no lo lee de la closure — igual
 * que `formatSkipReport`, y por la misma razón: para poder testearlo. El issue
 * lo dice explícitamente: "hay que testear el test del informe".
 */
export function formatOmissionReport(source: Map<string, Map<Capability, string[]>> = registry): string {
  if (source.size === 0) return '';
  const byReason = new Map<string, string[]>();
  for (const [feature, perCapability] of source) {
    for (const [capability, scenarios] of perCapability) {
      const label = SKIP_REASONS[capability];
      byReason.set(label, [...(byReason.get(label) ?? []), `${feature} (${scenarios.length})`]);
    }
  }
  const lines = [...byReason.entries()].map(([label, features]) => `  ${label}: ${features.join(', ')}`);
  return ['⚠ [gherkin] escenarios omitidos por entorno — lo NO verificado en esta máquina:', ...lines].join('\n');
}

/**
 * Qué hace una línea del .feature con los tags pendientes.
 *
 * Un tag pertenece a la línea clave que viene JUSTO después: se acumulan y se
 * consumen al encontrar esa línea. Si se asignaran "a todo lo que sigue al
 * primer escenario", cada escenario heredaría los de todos los anteriores.
 */
const RE_FEATURE = /^(Característica|Requisito|Necesidad del negocio)\b/;
const RE_SCENARIO = /^(?:Escenario|Esquema del escenario|Ejemplo)\b/;

type Linea = { kind: 'ignorar' } | { kind: 'feature' } | { kind: 'descartarTags' } | { kind: 'escenario'; name: string };

function clasificar(trimmed: string): Linea {
  if (trimmed === '' || trimmed.startsWith('#')) return { kind: 'ignorar' };
  if (trimmed.startsWith('@')) return { kind: 'ignorar' };
  if (RE_FEATURE.test(trimmed)) return { kind: 'feature' };
  // `Ejemplos:` cierra el esquema; sus filas no son escenarios.
  if (/^Ejemplos\b/.test(trimmed)) return { kind: 'descartarTags' };
  // Las filas de `Ejemplos` y de DataTable empiezan con `|`.
  if (trimmed.startsWith('|')) return { kind: 'ignorar' };
  if (!RE_SCENARIO.test(trimmed)) return { kind: 'ignorar' };
  const name = trimmed.replace(RE_SCENARIO, '').replace(/:\s*$/, '').trim();
  return { kind: 'escenario', name };
}

interface Escenario {
  name: string;
  line: number;
  tags: string[];
}

/** Los escenarios de un .feature con los tags que cada uno arrastra. */
function collectScenarios(lines: string[]): { featureTags: string[]; scenarios: Escenario[] } {
  let inDocstring = false;
  let pendingTags: string[] = [];
  let featureTags: string[] = [];
  const scenarios: Escenario[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? '';
    if (trimmed.startsWith('"""')) {
      inDocstring = !inDocstring;
      continue;
    }
    // El cuerpo de un docstring es dato, no estructura.
    if (inDocstring) continue;

    if (trimmed.startsWith('@')) {
      pendingTags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith('@')));
      continue;
    }

    const line = clasificar(trimmed);
    if (line.kind === 'ignorar') continue;
    if (line.kind === 'feature') {
      featureTags = pendingTags;
    } else if (line.kind === 'escenario') {
      scenarios.push({ name: line.name, line: i + 1, tags: pendingTags });
    }
    // Los tres casos consumen lo pendiente, también `descartarTags`.
    pendingTags = [];
  }

  return { featureTags, scenarios };
}

/** Recorre un .feature y registra lo que esta máquina no puede correr. */
function evaluarFeature(path: string, source: string, available: Record<Capability, boolean>, toFilter: Set<Capability>): void {
  const { featureTags, scenarios } = collectScenarios(source.split('\n'));
  for (const scenario of scenarios) {
    for (const capability of requiredBy([...featureTags, ...scenario.tags], available)) {
      toFilter.add(capability);
      registerOmission(path, capability, `${scenario.name} (#${scenario.line})`);
    }
  }
}

/**
 * Reparte los features entre lo que se puede correr y lo que no.
 *
 * Devuelve las capabilities que hay que filtrar. Los escenarios descartados
 * quedan registrados: el filtro los calla, el informe los delata.
 *
 * El alcance de un tag es el de Gherkin: uno en la `Característica` aplica a
 * todos sus escenarios, y uno en un `Escenario` sólo a ese. Se resuelven los dos
 * casos porque el issue los pide: el tagging puede ser por bloque o por
 * escenario.
 */
export function evaluate(featureFiles: { path: string; source: string }[], available: Record<Capability, boolean>): Capability[] {
  resetOmissions();
  const toFilter = new Set<Capability>();
  for (const { path, source } of featureFiles) evaluarFeature(path, source, available, toFilter);
  return CAPABILITIES.filter((c) => toFilter.has(c));
}

/** Capabilities que los tags piden y esta máquina no tiene. */
function requiredBy(tags: string[], available: Record<Capability, boolean>): Capability[] {
  const out: Capability[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(`@${TAG_PREFIX}`)) continue;
    const capability = tag.slice(TAG_PREFIX.length + 1) as Capability;
    // Un tag `@requires-xyz` que no está en la tabla es un error de escritura,
    // no una capability ausente: ignorarlo en silencio sería la peor opción,
    // porque el escenario correría sin saber que el autor pretendía otra cosa.
    if (!CAPABILITIES.includes(capability)) {
      throw new Error(`tag "${tag}" no corresponde a ninguna capability. Conocidas: ${CAPABILITIES.map((c) => `@${TAG_PREFIX}${c}`).join(', ')}`);
    }
    if (!available[capability]) out.push(capability);
  }
  return out;
}

/** El filtro `--tags` que le pasa a cucumber lo que sí se puede correr. */
export function tagFilter(omitir: Capability[]): string {
  if (omitir.length === 0) return '';
  return omitir.map((c) => `not @${TAG_PREFIX}${c}`).join(' and ');
}
