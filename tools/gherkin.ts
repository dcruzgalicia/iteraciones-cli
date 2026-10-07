#!/usr/bin/env bun
/**
 * #2549 — runner de Gherkin con gating por capability.
 *
 * Sustituye a `cucumber-js` directo en el script `gherkin`. El orden importa:
 *
 *   1. detectar capabilities del entorno
 *   2. recorrer los features y registrar lo que NO se puede correr   ← antes de filtrar
 *   3. construir `--tags 'not @requires-…'` con lo que falta
 *   4. correr cucumber
 *   5. imprimir el informe de omitidos en stderr
 *
 * El paso 2 es el que hace que el informe signifique algo. Con sólo el filtro
 * (3), cucumber omite en silencio y no hay forma de distinguir "no había nada"
 * de "no corrió la mitad". El issue llama a esto el fallo caro.
 *
 * ## Por qué un wrapper y no un hook de cucumber
 *
 * Los tags de cucumber son estáticos: se aplican al escribir el feature, no se
 * evalúan contra el entorno. No hay hook que pueda decidir "este scenario no
 * corre" — un `Before` que lance excepción lo convierte en fallo, no en
 * omisión. El filtrado tiene que ocurrir antes de arrancar el runner, y el
 * registro tiene que vivir en un sitio que sobreviva al proceso de cucumber.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type Capability, detectCapabilities } from '../src/test/gating/capabilities.js';
import { evaluate, formatOmissionReport, tagFilter } from '../src/test/gating/skip-report.js';

const FEATURES = 'features';

function featureFiles(dir: string): { path: string; source: string }[] {
  const salida: { path: string; source: string }[] = [];
  const recorrer = (actual: string): void => {
    for (const entrada of readdirSync(actual)) {
      const ruta = join(actual, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (ruta.endsWith('.feature')) salida.push({ path: ruta, source: readFileSync(ruta, 'utf8') });
    }
  };
  try {
    recorrer(dir);
  } catch {
    return [];
  }
  return salida;
}

/**
 * `ITERACIONES_SIN_CAPABILITY=pandoc,latex` simula una máquina a la que le
 * faltan cosas. Es lo que permite verificar el criterio del issue —"la lista
 * de omitidos en una máquina sin pandoc es la misma que da `describe.skipIf`
 * hoy"— sin desinstalar nada.
 */
function forcedFromEnv(): Partial<Record<Capability, boolean>> | undefined {
  const raw = process.env.ITERACIONES_SIN_CAPABILITY;
  if (raw === undefined || raw.trim() === '') return undefined;
  const forced: Partial<Record<Capability, boolean>> = {};
  for (const nombre of raw.split(',')) {
    const capability = nombre.trim();
    if (capability === '') continue;
    forced[capability as Capability] = false;
  }
  return forced;
}

const available = await detectCapabilities(forcedFromEnv());
const omitir = evaluate(featureFiles(FEATURES), available);

// `bunx`, no `cucumber-js`: el shim de node_modules/.bin lleva shebang
// `#!/usr/bin/env node`, así que lanzarlo directo exige node en el PATH aunque
// todo el repo sea bun. Con `bunx` lo corre el propio bun.
const args = ['bunx', 'cucumber-js'];
const filtro = tagFilter(omitir);
if (filtro !== '') args.push('--tags', filtro);
for (const arg of process.argv.slice(2)) args.push(arg);

const proc = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
const code = await proc.exited;

const report = formatOmissionReport();
if (report !== '') process.stderr.write(`\n${report}\n`);

process.exit(code);
