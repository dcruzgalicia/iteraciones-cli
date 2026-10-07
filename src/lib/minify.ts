import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logWarning } from './logger.js';

const BIN = 'minify';

export async function minifyAvailable(): Promise<boolean> {
  return Bun.spawn([BIN, '-l'], { stdout: 'ignore', stderr: 'ignore' })
    .exited.then((code) => code === 0)
    .catch(() => false);
}

export async function checkMinify(): Promise<{ label: string; ok: boolean; detail?: string; warn: boolean }> {
  const ok = await minifyAvailable();
  return {
    label: 'minify instalado',
    ok,
    warn: true,
    detail: ok
      ? 'minifica el HTML de la salida'
      : 'no encontrado en PATH. Instálalo desde https://github.com/tdewolff/minify (por ejemplo: brew install minify)',
  };
}

export async function minifyHtml(html: string): Promise<string> {
  if (!(await minifyAvailable())) {
    logWarning('minify no está en PATH; el HTML sale sin minificar. Instálalo con `brew install minify`', 'html');
    return html;
  }
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-minify-'));
  const input = join(dir, 'in.html');
  const output = join(dir, 'out.html');
  await Bun.write(input, html);
  const proc = Bun.spawn([BIN, '--html-keep-quotes', '-o', output, input], { stdout: 'ignore', stderr: 'pipe' });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    logWarning(`minify falló; el HTML sale sin minificar. stderr: ${stderr.trim()}`, 'html');
    return html;
  }
  const text = await Bun.file(output).text();
  await rm(dir, { recursive: true, force: true });
  return text;
}
