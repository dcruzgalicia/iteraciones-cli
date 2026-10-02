import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { getPandocVersion } from '../../lib/pandoc-runner.js';

/**
 * #2543 — E2E de `build.sh` con subprocess real.
 *
 * A diferencia de `vocabulario.steps.ts`, aquí `build()` y `bash build.sh`
 * corren de verdad: pandoc, el compositor y el shell son procesos hijos. Es la
 * mitad de la suite que más se parece a como trabaja una persona.
 *
 * Los hooks hacen de `withTempDir`: cucumber no tiene try/finally por
 * escenario, así que el directorio temporal se crea en `Before` y se borra en
 * `After` (ver respuesta 3 al issue).
 *
 * Los helpers `snapshot`, `replayBuildScript` y `expectSystemCommands` se
 * copiaron tal cual de `script-build.test.ts`. Duplicate a propósito durante el
 * spike: #2543 pide que los tests convivan, no Replace. En la onda que migre
 * este archivo, el original se borra y estos quedan como la única copia.
 */

const CONFIG = [
  'language: es-MX',
  'script: true',
  'format:',
  '  latex:',
  '    generate: true',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  epub:',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

const DOC = ['---', 'title: Documento', 'creator:', '  - Ana Ruiz', '---', '', '## Capítulo', '', 'Contenido.'].join('\n');

async function snapshot(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(relative(dir, path), await readFile(path));
    }
  };
  await walk(dir);
  return files;
}

function replayBuildScript(dir: string): { code: number; stderr: string } {
  const proc = Bun.spawnSync(['bash', join(dir, 'build.sh')], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  return { code: proc.exitCode, stderr: new TextDecoder().decode(proc.stderr ?? new Uint8Array()) };
}

/** #2445/#2456: los únicos comandos del SO que el .sh puede usar. */
function comandosDelSistema(script: string): string[] {
  const found = new Set<string>();
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('set ') || line.startsWith('cd ') || line.startsWith('(cd ')) continue;
    const token = /^[A-Za-z0-9_./-]+/.exec(line.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+ )+/, ''))?.[0] ?? '';
    const name = token.split('/').at(-1) ?? '';
    if (['cp', 'rm', 'ln', 'rmdir'].includes(name)) found.add(name);
    if (line.includes(' && ')) found.add('&&');
  }
  return [...found].sort();
}

interface BuildScriptWorld {
  dir: string;
  script: string;
  copiaPrevia: Map<string, Buffer>;
  codigoReplay: number;
  stderrReplay: string;
}

const mundo: BuildScriptWorld = {
  dir: '',
  script: '',
  copiaPrevia: new Map(),
  codigoReplay: 0,
  stderrReplay: '',
};

// Sólo pandoc hace falta: el documento de prueba no tiene imágenes, así que
// ImageMagick no participa. En el original el `skipIf` de magick cubría otro
// describe (el de las imágenes procesadas), que este feature no migra.
const pandocOk = (await getPandocVersion().catch(() => null)) !== null;

Before(async () => {
  mundo.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  await Bun.write(join(mundo.dir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
  await Bun.write(join(mundo.dir, 'documento.md'), `${DOC}\n`);
});

After(async () => {
  await rm(mundo.dir, { recursive: true, force: true });
});

Given('un proyecto de prueba con la clave script activada', () => {
  // El setup real va en Before; este step documenta la precondición del
  // escenario y falla si pandoc no está, en vez de dar un error confuso más abajo.
  if (!pandocOk) throw new Error('pandoc no está disponible: este feature necesita pandoc real');
});

When('corro el build', async () => {
  await build(mundo.dir);
  mundo.script = await Bun.file(join(mundo.dir, 'build.sh')).text();
});

Then('build.sh existe y es ejecutable', async () => {
  const existe = await Bun.file(join(mundo.dir, 'build.sh')).exists();
  if (!existe) throw new Error('build.sh no se escribió en la raíz del proyecto');
});

Then('build.sh empieza con la cabecera de bash y se mueve a la raíz del proyecto', async () => {
  const canonico = await realpath(mundo.dir);
  if (!mundo.script.startsWith('#!/bin/bash\nset -e\ncd ')) {
    throw new Error(`la cabecera no es la esperada. Empieza con: ${JSON.stringify(mundo.script.slice(0, 40))}`);
  }
  if (!mundo.script.includes(`cd ${canonico}`)) throw new Error(`build.sh no hace cd a la raíz canónica ${canonico}`);
});

Then('build.sh prepara sus directorios con mkdir y no invoca iteraciones prepare', () => {
  if (!mundo.script.includes('# === Preparación (directorios) ===')) throw new Error('falta la sección de preparación');
  if (!/^mkdir -p \S/m.test(mundo.script)) throw new Error('no hay ningún mkdir -p');
  if (mundo.script.includes('iteraciones prepare')) throw new Error('build.sh no debe invocar iteraciones prepare (#2456)');
});

Then('build.sh tiene una sección por cada formato generado', () => {
  for (const seccion of [
    '# === Recursos: plantillas, colecciones y assets (iteraciones) ===',
    '# === Salidas de iteraciones (post-proceso y markdown) ===',
    '# === Pandoc: LaTeX ===',
    '# === Pandoc: HTML ===',
    '# === Pandoc: EPUB ===',
  ]) {
    if (!mundo.script.includes(seccion)) throw new Error(`falta la sección ${seccion}`);
  }
});

Then('build.sh no invoca ningún comando de sistema aparte de cd y mkdir', () => {
  const prohibidos = comandosDelSistema(mundo.script);
  if (prohibidos.length > 0) throw new Error(`build.sh usa comandos del SO prohibidos: ${prohibidos.join(', ')}`);
});

Then('build.sh redirige la salida de cada formato a dist', () => {
  if (!mundo.script.includes('.iteraciones/script/in-')) throw new Error('falta la materialización de la entrada');
  for (const ext of ['tex', 'html']) {
    if (!new RegExp(`> *[^\\n]*dist/files/[^\\n]*\\.${ext}\\b`).test(mundo.script)) {
      throw new Error(`no hay redirect a dist/files/*.${ext}`);
    }
  }
});

Then('el markdown de dist lo escribe iteraciones y no un redirect de pandoc', () => {
  const redirectAMarkdown = /> *[^\n]*dist\/files\/[^\n]*\.md\b/.test(mundo.script);
  const escribeConIteraciones = /^\s*iteraciones markdown \S+ -o \S+dist\/files\/\S+\.md$/m.test(mundo.script);
  if (redirectAMarkdown) {
    throw new Error('el .sh no debe escribir el markdown de dist con un redirect de pandoc');
  }
  if (!escribeConIteraciones) {
    throw new Error('falta `iteraciones markdown ... -o dist/files/....md`');
  }
});

Then('build.sh no invoca los subcomandos de iteraciones que rehacen el trabajo', () => {
  if (/\biteraciones\s+(build|new|init|clean|validate|doctor)\b/.test(mundo.script)) {
    throw new Error('build.sh no debe invocar build/new/init/clean/validate/doctor');
  }
  if (!/^\s*iteraciones (template|post|prepare|assets|markdown) /m.test(mundo.script)) {
    throw new Error('falta al menos un subcomando permitido de iteraciones');
  }
  if (mundo.script.includes('iteraciones merge')) throw new Error('build.sh no debe invocar iteraciones merge');
});

When('guardo una copia de las salidas de dist', async () => {
  mundo.copiaPrevia = await snapshot(join(mundo.dir, 'dist', 'files'));
  if (mundo.copiaPrevia.size < 4) {
    throw new Error(`esperaba al menos 4 salidas (.tex, .html, .epub, .md) y hay ${mundo.copiaPrevia.size}`);
  }
});

When('reejecuto build.sh con bash', () => {
  const { code, stderr } = replayBuildScript(mundo.dir);
  mundo.codigoReplay = code;
  mundo.stderrReplay = stderr;
});

Then('el código de salida es 0', () => {
  if (mundo.codigoReplay !== 0) throw new Error(`bash build.sh salió con ${mundo.codigoReplay}\n${mundo.stderrReplay}`);
});

Then('dist tiene los mismos archivos que antes', async () => {
  const despues = await snapshot(join(mundo.dir, 'dist', 'files'));
  const antes = [...mundo.copiaPrevia.keys()].sort();
  const ahora = [...despues.keys()].sort();
  if (JSON.stringify(antes) !== JSON.stringify(ahora)) {
    throw new Error(`dist cambió de archivos.\n  antes: ${JSON.stringify(antes)}\n  ahora: ${JSON.stringify(ahora)}`);
  }
});

Then('cada archivo es idéntico byte a byte salvo el epub', async () => {
  const despues = await snapshot(join(mundo.dir, 'dist', 'files'));
  for (const [name, bytes] of mundo.copiaPrevia) {
    // El EPUB lleva fecha de compilación: sólo puede exigírsele que exista.
    if (name.endsWith('.epub')) {
      if (despues.get(name) === undefined) throw new Error(`${name} no se regeneró`);
      continue;
    }
    if (despues.get(name)?.equals(bytes) !== true) throw new Error(`bytes distintos en ${name}`);
  }
});
