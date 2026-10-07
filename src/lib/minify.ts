import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logWarning } from './logger.js';

const BIN = 'minify';

// ponytail: memoizado como `detectMagick`; antes eran dos spawns por documento y la respuesta
// no cambia dentro de un build. `resetMinifyCache` lo limpia para los tests.
let available: boolean | null = null;

export async function minifyAvailable(): Promise<boolean> {
  if (available !== null) return available;
  available = await Bun.spawn([BIN, '-l'], { stdout: 'ignore', stderr: 'ignore' })
    .exited.then((code) => code === 0)
    .catch(() => false);
  return available;
}

export function resetMinifyCache(): void {
  available = null;
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
  // ponytail: sin try/finally el temp se quedaba en cada fallo (`code !== 0` hacía return antes del
  // rm), y como se llama por documento, un `minify` roto acumulaba un temp por página.
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-minify-'));
  try {
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
    return await Bun.file(output).text();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
