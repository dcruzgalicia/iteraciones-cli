import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { When } from '@cucumber/cucumber';
import { world } from './cli-world.steps.js';

const HERRAMIENTAS = ['pandoc', 'magick', 'latexmk', 'pdflatex', 'biber', 'pdftoppm', 'minify'];

async function buildConHerramientas(faltantes: string[]): Promise<void> {
  const bin = mkdtempSync(join(tmpdir(), 'iteraciones-herramientas-'));
  for (const herramienta of HERRAMIENTAS) {
    if (faltantes.includes(herramienta)) continue;
    const ruta = Bun.which(herramienta);
    if (ruta !== null) symlinkSync(ruta, join(bin, herramienta));
  }

  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '../../bin.ts'), 'build'], {
    cwd: world.root,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  world.stdout = stdout;
  world.stderr = stderr;
  world.exitCode = codigo;
}

When('hago un build sin minify', async () => {
  await buildConHerramientas(['minify']);
});

When('hago un build sin {string}', async (faltante: string) => {
  await buildConHerramientas([faltante]);
});
