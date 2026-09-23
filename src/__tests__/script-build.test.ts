import { describe, expect, it } from 'bun:test';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { checkLatexEngine } from '../cli/doctor/system-checks.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2438 — `format.script: true` hace que cada build escriba `build.sh` en la
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

describe('format.script (#2438)', () => {
  it('por defecto es false y acepta true/false', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n');
      expect((await loadSiteConfig(dir)).format.script).toBe(false);

      await Bun.write(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  script: true\n');
      expect((await loadSiteConfig(dir)).format.script).toBe(true);

      await Bun.write(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  script: false\n');
      expect((await loadSiteConfig(dir)).format.script).toBe(false);
    });
  });
});

describe.skipIf(!pandocOk)('build.sh con format.script (#2438)', () => {
  const CONFIG = [
    'language: es-MX',
    'format:',
    '  script: true',
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
      expect(script).toContain(`cd ${process.cwd()}`);

      expect(script).toContain('# === Pandoc: LaTeX ===');
      expect(script).toContain('# === Pandoc: HTML ===');
      expect(script).toContain('# === Pandoc: EPUB ===');

      // Cada paso es un comando: entrada materializada y salida redirigida.
      expect(script).toContain('.iteraciones/script/in-');
      expect(script).toMatch(/> *[^\n]*dist\/files\/[^\n]*\.tex\b/);
      expect(script).toMatch(/> *[^\n]*dist\/files\/[^\n]*\.html\b/);

      // El markdown de dist lo compone TypeScript: el .sh jamás lo pisa.
      expect(script).not.toMatch(/> *[^\n]*dist\/files\/[^\n]*\.md\b/);
      // Sin lógica: el .sh no vuelve a invocar al CLI.
      expect(script).not.toMatch(/\biteraciones\s+[a-z]/);
      expect(script).not.toContain('iteraciones merge');
    });
  });

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
        'format:',
        '  script: true',
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
      expect(script).toContain('# === Procesamiento de imágenes (ImageMagick) ===');
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

describe.skipIf(!pandocOk || !latexOk)('build.sh con PDF (#2438)', () => {
  it('incluye latexmk con sus pasos de soporte y vuelve a dejar el PDF en dist', async () => {
    await withTempDir(async (dir) => {
      const config = ['language: es-MX', 'format:', '  script: true', '  pdf:', '    generate: true'].join('\n');
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.write(
        join(dir, 'manuscrito.md'),
        ['---', 'title: Cuidar-se', 'date: 2026-01-01', '---', '', '# Capítulo', '', 'Contenido.'].join('\n'),
      );

      await build(dir, { full: true });

      const script = await Bun.file(join(dir, 'build.sh')).text();
      expect(script).toContain('# === PDF (latexmk) ===');
      expect(script).toMatch(/latexmk [^\n]*-jobname=/);
      expect(script).toContain('mkdir -p ');
      expect(script).toContain('rm -f ');
      expect(script).toMatch(/\smv /);
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
