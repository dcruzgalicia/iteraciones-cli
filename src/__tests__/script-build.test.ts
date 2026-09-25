import { describe, expect, it } from 'bun:test';
import { readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { checkLatexEngine } from '../cli/doctor/system-checks.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2438 — `script: true` hace que cada build escriba `build.sh` en la
 * raíz del proyecto con los comandos externos que corrieron en esa corrida.
 *
 * Se verifica: (a) el schema sin dependencias de entorno; (b) la estructura del
 * .sh (ejecutable, cabecera, secciones, solo comandos — nunca invoca al CLI ni
 * pisa el markdown de dist que compone TypeScript); (c) que `bash build.sh`
 * salga con 0 y deje las salidas byte-idénticas; (d) los casos ImageMagick y
 * latexmk con sus pasos de soporte.
 *
 * pandoc/ImageMagick/motor LaTeX: skip informado si faltan (decisión D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('script-build.test.ts', SKIP_REASONS.pandoc);

const magickOk = await Bun.spawn(['magick', '-version'], { stdout: 'ignore', stderr: 'ignore' })
  .exited.then((code) => code === 0)
  .catch(() => false);
if (!magickOk) registerSkip('script-build.test.ts', SKIP_REASONS.magick);

const latexOk = (await checkLatexEngine()).ok;
if (!latexOk) registerSkip('script-build.test.ts', SKIP_REASONS.latex);

/** ¿Hay binario en el PATH? (poppler da `pdftotext`, y unzip hace el resto). */
async function commandOk(argv: string[]): Promise<boolean> {
  try {
    await Bun.spawn(argv, { stdout: 'ignore', stderr: 'ignore' }).exited;
    return true;
  } catch {
    return false;
  }
}

const pdftotextOk = await commandOk(['pdftotext', '-v']);
if (!pdftotextOk) registerSkip('script-build.test.ts', SKIP_REASONS.pdftotext);
const unzipOk = await commandOk(['unzip', '-v']);
if (!unzipOk) registerSkip('script-build.test.ts', SKIP_REASONS.unzip);

/**
 * Texto extraído de un PDF: .pdf y .epub no tienen que ser byte-idénticos
 * (pandoc y latexmk meten uuid y fechas de creación), solo idénticos en lo que
 * viene del markdown original.
 */
async function pdfText(dir: string, bytes: Buffer): Promise<string> {
  const tmp = join(dir, `.tmp-${Math.random().toString(36).slice(2)}.pdf`);
  await Bun.write(tmp, bytes);
  try {
    const proc = Bun.spawnSync(['pdftotext', tmp, '-'], { stdout: 'pipe', stderr: 'pipe' });
    return new TextDecoder().decode(proc.stdout ?? new Uint8Array());
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/** Entradas del EPUB, sin el OPF ni el NCX (uuid + fecha de modificación). */
async function epubEntries(dir: string, bytes: Buffer): Promise<Map<string, Uint8Array>> {
  const tmp = join(dir, `.tmp-${Math.random().toString(36).slice(2)}.epub`);
  await Bun.write(tmp, bytes);
  try {
    const listed = Bun.spawnSync(['unzip', '-Z1', tmp], { stdout: 'pipe', stderr: 'pipe' });
    const entries = new Map<string, Uint8Array>();
    for (const entry of new TextDecoder()
      .decode(listed.stdout ?? new Uint8Array())
      .split('\n')
      .filter(Boolean)) {
      if (entry.endsWith('.opf') || entry.endsWith('.ncx')) continue;
      const shown = Bun.spawnSync(['unzip', '-p', tmp, entry], { stdout: 'pipe', stderr: 'pipe' });
      entries.set(entry, shown.stdout ?? new Uint8Array());
    }
    return entries;
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/**
 * Una salida de dist, entre la corrida de `iteraciones build --full` y la de
 * `bash build.sh`. Todo debe ser byte-idéntico salvo pdf (texto) y epub (zip).
 */
async function expectSameOutput(dir: string, name: string, before: Buffer, after: Buffer): Promise<void> {
  if (name.endsWith('.pdf')) {
    expect(await pdfText(dir, before), `texto distinto en ${name}`).toBe(await pdfText(dir, after));
    return;
  }
  if (name.endsWith('.epub')) {
    const a = await epubEntries(dir, before);
    const b = await epubEntries(dir, after);
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [entry, data] of a) {
      expect(sameBytes(b.get(entry) as Uint8Array, data), `EPUB distinto en ${entry}`).toBe(true);
    }
    return;
  }
  expect(after.equals(before), `bytes distintos en ${name}`).toBe(true);
}

/** Todos los archivos de dist con sus bytes, como mapa relativo → contenido. */
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

/** Ejecuta build.sh tal cual lo haría una persona y devuelve el exit code. */
function replayBuildScript(dir: string): { code: number; stderr: string } {
  const proc = Bun.spawnSync(['bash', join(dir, 'build.sh')], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  return { code: proc.exitCode, stderr: new TextDecoder().decode(proc.stderr ?? new Uint8Array()) };
}

/**
 * Comandos del sistema operativo que aparecen en el .sh. El objetivo de #2445
 * es que no quede ninguno: la preparación y la recogida son subcomandos de
 * iteraciones. `set`/`cd` son preparación del shell y no se cuentan.
 */
function expectSystemCommands(script: string): string[] {
  const found = new Set<string>();
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('set ') || line.startsWith('cd ') || line.startsWith('(cd ')) continue;
    // Las líneas se reordenan por sección; el primer token es el comando real.
    const token = /^[A-Za-z0-9_./-]+/.exec(line.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+ )+/, ''))?.[0] ?? '';
    const name = token.split('/').at(-1) ?? '';
    if (['mkdir', 'cp', 'rm', 'mv', 'ln', 'rmdir'].includes(name)) found.add(name);
    if (line.includes(' && ')) found.add('&&');
  }
  return [...found].sort();
}

describe('script en la raíz (#2438, #2448)', () => {
  it('por defecto es false y acepta true/false', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n');
      expect((await loadSiteConfig(dir)).script).toBe(false);

      await Bun.write(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nscript: true\n');
      expect((await loadSiteConfig(dir)).script).toBe(true);

      await Bun.write(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nscript: false\n');
      expect((await loadSiteConfig(dir)).script).toBe(false);
    });
  });

  // #2448: format.script fue a la raíz; el error dice el rename.
  it('format.script ya no se acepta y el error apunta al rename', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  script: true\n');
      await expect(loadSiteConfig(dir)).rejects.toThrow('renombra la clave');
      await expect(loadSiteConfig(dir)).rejects.toThrow('format.script');
    });
  });
});

describe.skipIf(!pandocOk)('build.sh con script (#2438)', () => {
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

  async function setup(dir: string): Promise<void> {
    await Bun.write(join(dir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
    await Bun.write(join(dir, 'documento.md'), `${DOC}\n`);
  }

  it('escribe un build.sh ejecutable con las secciones de pandoc y solo comandos', async () => {
    await withTempDir(async (dir) => {
      await setup(dir);
      await build(dir);

      const scriptPath = join(dir, 'build.sh');
      expect(await Bun.file(scriptPath).exists()).toBe(true);
      expect((await stat(scriptPath)).mode & 0o111).not.toBe(0);

      const script = await Bun.file(scriptPath).text();
      expect(script.startsWith('#!/bin/bash\nset -e\ncd ')).toBe(true);
      // El .sh se ejecuta desde la raíz del proyecto (en canónico: ahí resuelven
      // los comandos de iteraciones, y process.cwd() de cada uno es físico).
      expect(script).toContain(`cd ${await realpath(dir)}`);

      // Los directorios los prepara iteraciones; no quedan mkdir/cp/rm/mv.
      expect(script).toContain('# === Preparación (iteraciones) ===');
      expect(script).toMatch(/^iteraciones prepare --dir /m);
      expect(script).toContain('# === Recursos: plantillas, colecciones y assets (iteraciones) ===');
      expect(script).toContain('# === Salidas de iteraciones (post-proceso y markdown) ===');
      expect(script).toContain('# === Pandoc: LaTeX ===');
      expect(script).toContain('# === Pandoc: HTML ===');
      expect(script).toContain('# === Pandoc: EPUB ===');
      expect(expectSystemCommands(script).filter((s) => s !== 'cd')).toEqual([]);

      // Cada paso es un comando: entrada materializada y salida redirigida.
      expect(script).toContain('.iteraciones/script/in-');
      expect(script).toMatch(/> *[^\n]*dist\/files\/[^\n]*\.tex\b/);
      expect(script).toMatch(/> *[^\n]*dist\/files\/[^\n]*\.html\b/);

      // El markdown de dist lo escribe `iteraciones markdown`; el .sh jamás
      // lo pisa con un redirect de pandoc.
      expect(script).not.toMatch(/> *[^\n]*dist\/files\/[^\n]*\.md\b/);
      expect(script).toMatch(/^\s*iteraciones markdown \S+ -o \S+dist\/files\/\S+\.md$/m);
      // Sin lógica: solo los subcomandos de recursos y post-proceso, nunca un build.
      expect(script).not.toMatch(/\biteraciones\s+(build|new|init|clean|validate|doctor)\b/);
      expect(script).toMatch(/^\s*iteraciones (template|post|prepare|assets|markdown) /m);
      expect(script).not.toContain('iteraciones merge');
    });
  });

  it('las colecciones entran por .iteraciones/collections y el replay sale idéntico', async () => {
    await withTempDir(async (dir) => {
      await setup(dir);
      await Bun.write(
        join(dir, 'coleccion.md'),
        ['---', 'title: Antología', 'type: collection', 'files:', '  - documento.md', '---', '', 'Intro de la antología.'].join('\n'),
      );
      await build(dir);

      const script = await Bun.file(join(dir, 'build.sh')).text();
      // la fase de recursos regenera cada entrada que pandoc va a leer por stdin
      expect(script).toMatch(/^\s*iteraciones merge coleccion\.md --format latex -o /m);
      expect(script).toMatch(/^\s*iteraciones merge coleccion\.md --format html -o /m);
      expect(script).toMatch(/< \.iteraciones\/collections\/antologia\.(latex|html)\.md/);

      const dist = join(dir, 'dist', 'files');
      const before = await snapshot(dist);
      const entradas = join(dir, '.iteraciones', 'collections');
      const entradasAntes = await snapshot(entradas);

      // las entradas materiaizadas desaparecen: solo los comandos las vuelven a crear
      await rm(entradas, { recursive: true, force: true });

      const { code, stderr } = replayBuildScript(dir);
      expect(code, stderr).toBe(0);

      const after = await snapshot(dist);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [name, bytes] of before) {
        // El EPUB lleva un uuid aleatorio: solo puede exigírsele que exista.
        if (name.endsWith('.epub')) {
          expect(after.get(name) !== undefined, `${name} no se regeneró`).toBe(true);
          continue;
        }
        expect(after.get(name)?.equals(bytes) === true, `bytes distintos en ${name}`).toBe(true);
      }
      const entradasDespues = await snapshot(entradas);
      expect([...entradasDespues.keys()].sort()).toEqual([...entradasAntes.keys()].sort());
      for (const [name, bytes] of entradasAntes) {
        expect(entradasDespues.get(name)?.equals(bytes) === true, `entrada distinta en ${name}`).toBe(true);
      }
    });
  }, 120_000);

  it('bash build.sh sale con 0 y deja las salidas byte-idénticas', async () => {
    await withTempDir(async (dir) => {
      await setup(dir);
      await build(dir);

      const dist = join(dir, 'dist', 'files');
      const before = await snapshot(dist);
      // .tex, .html, .epub y .md
      expect(before.size).toBeGreaterThanOrEqual(4);

      const { code, stderr } = replayBuildScript(dir);
      expect(code, stderr).toBe(0);

      const after = await snapshot(dist);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [name, bytes] of before) {
        // El EPUB lleva fecha de compilación: solo puede exigírsele que exista.
        if (name.endsWith('.epub')) {
          expect(after.get(name) !== undefined, `${name} no se regeneró`).toBe(true);
          continue;
        }
        expect(after.get(name)?.equals(bytes) === true, `bytes distintos en ${name}`).toBe(true);
      }
    });
  }, 60_000);
});

describe.skipIf(!pandocOk || !magickOk)('build.sh con imágenes (#2438)', () => {
  it('incluye ImageMagick y las imágenes procesadas salen idénticas', async () => {
    await withTempDir(async (dir) => {
      const config = [
        'language: es-MX',
        'script: true',
        'format:',
        '  html:',
        '    site:',
        '      title: T',
        '    generate: true',
        '  markdown:',
        '    generate: true',
      ].join('\n');
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:white', join(dir, 'foto.png')]);
      await Bun.write(join(dir, 'manuscrito.md'), ['---', 'title: Manuscrito', '---', '', '![foto](foto.png)', '', 'Contenido.'].join('\n'));

      await build(dir);

      const script = await Bun.file(join(dir, 'build.sh')).text();
      expect(script).toContain('# === Recursos: imágenes (ImageMagick) ===');
      expect(script).toContain('magick ');

      const dist = join(dir, 'dist', 'files');
      expect(await Bun.file(join(dist, 'assets', 'img', 'foto.jpg')).exists()).toBe(true);

      const before = await snapshot(dist);
      const { code, stderr } = replayBuildScript(dir);
      expect(code, stderr).toBe(0);

      const after = await snapshot(dist);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [name, bytes] of before) {
        expect(after.get(name)?.equals(bytes) === true, `bytes distintos en ${name}`).toBe(true);
      }
    });
  }, 60_000);
});

describe.skipIf(!pandocOk || !magickOk)('build.sh con .tex en dist (#2445)', () => {
  it('el post-proceso latex viaja por manifiesto y el .tex de dist sale idéntico', async () => {
    await withTempDir(async (dir) => {
      const config = ['language: es-MX', 'script: true', 'format:', '  latex:', '    generate: true'].join('\n');
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:white', join(dir, 'foto.png')]);
      await Bun.write(
        join(dir, 'ensayo.md'),
        ['---', 'title: Ensayo', '---', '', '# Capítulo', '', '![foto](foto.png)', '', 'Contenido.'].join('\n'),
      );

      await build(dir);

      const script = await Bun.file(join(dir, 'build.sh')).text();
      // la salida cruda de pandoc difiere de la de dist: alguien debe transformarla
      expect(script).toMatch(/^\s*iteraciones post latex --post \S+\.iteraciones\/post\/ensayo\.json -o \S+ensayo\.tex/m);
      expect(script).toMatch(/< \.iteraciones\/script\/out-\d+\.tex/);

      // el manifiesto es un artefacto del build: build.sh lo lee, no lo regenera
      const manifest = JSON.parse(await Bun.file(join(dir, '.iteraciones', 'post', 'ensayo.json')).text());
      expect(Object.keys(manifest.distribution ?? {})).toHaveLength(1);

      const dist = join(dir, 'dist', 'files');
      const tex = join(dist, 'ensayo.tex');
      expect(await Bun.file(tex).exists()).toBe(true);
      // las imágenes comparten directorio con el .tex, con nombre del slug
      expect(await Bun.file(join(dist, 'ensayo-foto.jpg')).exists()).toBe(true);

      const before = await snapshot(dist);
      const { code, stderr } = replayBuildScript(dir);
      expect(code, stderr).toBe(0);

      const after = await snapshot(dist);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [name, bytes] of before) {
        expect(after.get(name)?.equals(bytes) === true, `bytes distintos en ${name}`).toBe(true);
      }
    });
  }, 60_000);
});

describe.skipIf(!pandocOk || !latexOk)('build.sh con PDF (#2438)', () => {
  it('incluye latexmk con sus pasos de soporte y vuelve a dejar el PDF en dist', async () => {
    await withTempDir(async (dir) => {
      const config = ['language: es-MX', 'script: true', 'format:', '  pdf:', '    generate: true'].join('\n');
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.write(
        join(dir, 'manuscrito.md'),
        ['---', 'title: Cuidar-se', 'date: 2026-01-01', '---', '', '# Capítulo', '', 'Contenido.'].join('\n'),
      );

      await build(dir, { full: true });

      const script = await Bun.file(join(dir, 'build.sh')).text();
      expect(script).toContain('# === PDF (latexmk) ===');
      expect(script).toMatch(/latexmk [^\n]*-jobname=/);
      // El slot lo prepara y lo recoge iteraciones: sin mkdir/rm/mv sueltos.
      expect(script).toMatch(/^\s*iteraciones prepare .*--xmp \S*slot-0$/m);
      expect(script).toMatch(/^\s*iteraciones pdf collect \S*slot-0 -o \S*dist\/files\/cuidar-se\.pdf$/m);
      expect(expectSystemCommands(script).filter((s) => s !== 'cd')).toEqual([]);
      // Sin latex en dist, la entrada cruda de pandoc va a un intermedio.
      expect(script).toContain('.iteraciones/script/out-');

      const dist = join(dir, 'dist', 'files');
      const pdf = join(dist, 'cuidar-se.pdf');
      expect(await Bun.file(pdf).exists()).toBe(true);

      // dist desaparece: solo los comandos del .sh pueden volver a poblarlo.
      await rm(dist, { recursive: true, force: true });

      const { code, stderr } = replayBuildScript(dir);
      expect(code, stderr).toBe(0);
      expect(await Bun.file(pdf).exists()).toBe(true);
      expect((await Bun.file(pdf).arrayBuffer()).byteLength).toBeGreaterThan(1000);
    });
  }, 180_000);
});

/**
 * Contrato de #2445: `iteraciones build --full` y `bash build.sh` producen las
 * mismas salidas. Todo lo que sale de dist debe ser reproducible con solo los
 * comandos del .sh (pandoc/ImageMagick/latexmk + subcomandos de iteraciones).
 *
 * Salvedad de contenido: .pdf y .epub llevan uuid y fecha de creación, que no
 * son contenido del markdown; se comparan por texto (pdftotext) y por entradas
 * del zip (sin OPF/NCX), nunca por bytes.
 */
describe.skipIf(!pandocOk || !magickOk || !latexOk || !pdftotextOk || !unzipOk)('equivalencia build --full ≡ bash build.sh (#2445)', () => {
  it('deja el mismo dist, byte a byte salvo el contenido sustancial de pdf y epub', async () => {
    await withTempDir(async (dir) => {
      const config = [
        'language: es-MX',
        'script: true',
        'format:',
        '  latex:',
        '    generate: true',
        '  pdf:',
        '    generate: true',
        '    coverImage: true',
        '  html:',
        '    site:',
        '      title: T',
        '    generate: true',
        '  epub:',
        '    generate: true',
        '  markdown:',
        '    generate: true',
      ].join('\n');
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:white', join(dir, 'foto.png')]);
      await Bun.write(
        join(dir, 'documento.md'),
        ['---', 'title: Manuscrito', 'creator:', '  - Ana Ruiz', '---', '', '# Capítulo', '', '![foto](foto.png)', '', 'Contenido.'].join('\n'),
      );
      await Bun.write(
        join(dir, 'coleccion.md'),
        ['---', 'title: Antología', 'type: collection', 'files:', '  - documento.md', '---', '', 'Intro de la antología.'].join('\n'),
      );
      // creator sin `title`: el build se lo deriva de `name`, y el .md de dist
      // debe salir igual por `iteraciones markdown` (#2445).
      await Bun.write(join(dir, 'creadora.md'), ['---', 'name: Ana Ruiz', 'type: creator', '---', '', 'Bio de la creadora.'].join('\n'));

      await build(dir, { full: true });

      const dist = join(dir, 'dist', 'files');
      const before = await snapshot(dist);

      // dist desaparece: solo los comandos del .sh pueden volver a poblarlo.
      await rm(dist, { recursive: true, force: true });
      const { code, stderr } = replayBuildScript(dir);
      expect(code, stderr).toBe(0);

      const after = await snapshot(dist);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

      for (const [name, bytes] of before) {
        const replayed = after.get(name);
        if (replayed === undefined) throw new Error(`falta ${name}`);
        await expectSameOutput(dir, name, bytes, replayed);
      }

      // El .sh del full cubre las cinco fases de #2445, sin comandos del SO.
      const script = await Bun.file(join(dir, 'build.sh')).text();
      for (const sub of ['prepare', 'assets', 'markdown', 'cover', 'pdf collect']) {
        expect(script).toContain(`iteraciones ${sub} `);
      }
      expect(expectSystemCommands(script).filter((s) => s !== 'cd')).toEqual([]);
    });
  }, 300_000);
});
