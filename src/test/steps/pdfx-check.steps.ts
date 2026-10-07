import { spyOn } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { runPdfxOutputValidation } from '../../builder/pdfx-check.js';
import { loadSiteConfig } from '../../config/config-loader.js';
import * as runLib from '../../lib/run.js';
import { ProcessSpawnError } from '../../lib/run.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — la validación PDF/X de la salida (#1960, #2163, #2454, #2499).
 *
 * El filtro 99-pdfx es la señal de imprenta: si un PDF no certifica, el build
 * falla. Por eso esta fase se comporta al revés que el resto: no es una
 * advertencia, es una puerta.
 *
 * ## Todo lo que el binario necesita se escribe de mentira
 *
 * Compilar el validador real es Rust y cargo. Los escenarios escriben un
 * binario falso que devuelve un JSON fijo, así que lo que se prueba es la
 * lectura del informe: qué cuenta como válido, qué se reporta y cómo.
 *
 * ## `XDG_CACHE_HOME` se aísla siempre
 *
 * Sin aislarla, cada escenario compila el binario de verdad en la caché del
 * usuario. Con `allowBuild` se llega a invocar cargo (#2163).
 */

const CONFIG_PDFX_ACTIVO =
  'language: es-MX\nformat:\n  pdf:\n    generate: true\n    disabledPreambleFilters:\n      - 97-eso-pic\n      - 98-crop\n';

/** La caché del binario va dentro del temporal del escenario: hermético. */
function aislarCacheBinario(): void {
  process.env.XDG_CACHE_HOME = join(world.root, 'cache');
}

/** Escribe un binario falso que emite un informe JSON fijo. */
function binarioQueDice(json: string): void {
  const dir = join(world.root, 'cache', 'iteraciones', 'bin');
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, 'iteraciones-pdfcheck');
  writeFileSync(ruta, `#!/bin/sh\ncat <<'EOF'\n${json}\nEOF\n`, 'utf8');
  chmodSync(ruta, 0o755);
}

/** Binario falso que certifica todo menos lo que el path llama «roto». */
function _binarioSelectivo(): void {
  const dir = join(world.root, 'cache', 'iteraciones', 'bin');
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, 'iteraciones-pdfcheck');
  writeFileSync(
    ruta,
    [
      '#!/bin/sh',
      'case "$1" in',
      "  *roto*) cat <<'EOF'",
      '{"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"}], "warnings": []}',
      'EOF',
      '    ;;',
      "  *) cat <<'EOF'",
      '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}',
      'EOF',
      '    ;;',
      'esac',
    ].join('\n'),
    'utf8',
  );
  chmodSync(ruta, 0o755);
}

/** La salida del build: `dist/files`, que es lo que se barre. */
function salida(): string {
  return join(world.root, 'dist', 'files');
}

type Config = Awaited<ReturnType<typeof loadSiteConfig>>;
function cargarConfig(): Promise<Config> {
  return loadSiteConfig(world.root);
}

/** El `Then` del fallo: si no hay excepción, el escenario está mal. */
async function esperarFallo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('no falló y debía: la validación PDF/X es una puerta, no un aviso');
}

// ── Escenario ──────────────────────────────────────────────────────────────

Given('un proyecto con la certificación PDFX activada', async () => {
  await Promise.resolve();
  aislarCacheBinario();
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_PDFX_ACTIVO);
  world.configPdfx = (await cargarConfig()) as Config;
  mkdirSync(salida(), { recursive: true });
});

Given('un proyecto con la certificación PDFX desactivada', async () => {
  await Promise.resolve();
  aislarCacheBinario();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    'language: es-MX\nformat:\n  pdf:\n    generate: true\n    disabledPreambleFilters:\n      - 97-eso-pic\n      - 98-crop\n      - 99-pdfx\n',
  );
  world.configPdfx = (await cargarConfig()) as Config;
  mkdirSync(salida(), { recursive: true });
});

/** PDF de mentira: al validador falso sólo le importa el nombre. */
Given('la salida tiene un PDF llamado {string}', (nombre: string) => {
  escribirEnProyecto(join('dist', 'files', nombre), '%PDF-1.4 fake');
});

Given('el binario de validación declara:', (json: string) => {
  binarioQueDice(json.trim());
});

Given('no hay binario de validación compilado', () => {
  aislarCacheBinario();
});

/** Cargo ausente: `buildPdfCheckBinary` retorna null y la fase se omite. */
Given('compilar el binario va a fallar', () => {
  spyOn(runLib, 'exec').mockRejectedValue(new ProcessSpawnError('cargo'));
  world.espiaStderr = spyOn(process.stderr, 'write');
});

/**
 * La validación puede DETENER el build: eso es un resultado legítimo, no un
 * error del escenario. El mensaje se guarda y lo verifica el `Entonces`.
 */
When('valido los PDF de la salida', async () => {
  world.espiaStderr = spyOn(process.stderr, 'write');
  try {
    world.resultadoPdfx = await runPdfxOutputValidation(salida(), world.configPdfx as Config, { allowBuild: false });
    world.mensajePdfx = '';
  } catch (e) {
    world.resultadoPdfx = undefined;
    world.mensajePdfx = e instanceof Error ? e.message : String(e);
  }
});

When('valido los PDF de la salida permitiendo compilar el binario', async () => {
  world.resultadoPdfx = await runPdfxOutputValidation(salida(), world.configPdfx as Config, { allowBuild: true });
});

Then('la validación se omite en silencio', () => {
  const r = world.resultadoPdfx as { validated: number; failed: number; summaryLine?: string };
  if (r.validated !== 0 || r.failed !== 0 || r.summaryLine !== undefined) {
    throw new Error(`se validó ${r.validated} y fallaron ${r.failed}: la validación debía omitirse`);
  }
});

Then('stderr está vacío', () => {
  const salida = (world.espiaStderr as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('');
  if (salida !== '') throw new Error(`stderr dijo ${JSON.stringify(salida)} y debía estar vacío`);
});

Then('stderr anuncia {string}', (texto: string) => {
  const salida = (world.espiaStderr as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('');
  if (!salida.includes(texto)) throw new Error(`stderr no dice ${JSON.stringify(texto)}. Dice:\n${salida}`);
});

/** El orden importa: el aviso tiene que explicar por qué se omite. */
Then('stderr anuncia {string} antes de {string}', (primero: string, segundo: string) => {
  const salida = (world.espiaStderr as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('');
  const a = salida.indexOf(primero);
  const b = salida.indexOf(segundo);
  if (a < 0 || b < 0) throw new Error(`stderr no dice ambos. Dice:\n${salida}`);
  if (a >= b) throw new Error(`${JSON.stringify(primero)} sale después de ${JSON.stringify(segundo)}`);
});

Then('se validan {int} PDF y fallan {int}', (validados: string, fallados: string) => {
  const r = world.resultadoPdfx as { validated: number; failed: number };
  if (r.validated !== Number(validados) || r.failed !== Number(fallados)) {
    throw new Error(`se validaron ${r.validated} y fallaron ${r.failed}, no ${validados} y ${fallados}`);
  }
});

Then('la línea de resumen dice {string}', (texto: string) => {
  const linea = (world.resultadoPdfx as { summaryLine?: string }).summaryLine ?? '(ninguna)';
  if (!linea.includes(texto)) throw new Error(`la línea es ${JSON.stringify(linea)} y no dice ${JSON.stringify(texto)}`);
});

/** Varios motivos separados por `;;`: el mensaje tiene que llevarlos todos. */
Then('la validación falla diciendo {string}', async (motivos: string) => {
  if (world.mensajePdfx === '') {
    world.mensajePdfx = await esperarFallo(() => runPdfxOutputValidation(salida(), world.configPdfx as Config, { allowBuild: false }));
  }
  const faltan = motivos
    .split(';;')
    .map((m) => m.trim())
    .filter(Boolean);
  const faltanRealmente = faltan.filter((m) => !world.mensajePdfx.includes(m));
  if (faltanRealmente.length > 0) {
    throw new Error(`al mensaje le faltan ${JSON.stringify(faltanRealmente)}. Dice:\n${world.mensajePdfx}`);
  }
});
