import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { When } from '@cucumber/cucumber';
import { world } from './cli-world.steps.js';

When('hago un build sin minify', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'iteraciones-sin-minify-'));
  for (const tool of ['pandoc', 'magick']) {
    const ruta = Bun.which(tool);
    if (ruta === null) throw new Error(`el escenario necesita ${tool} en PATH`);
    symlinkSync(ruta, join(bin, tool));
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
});
