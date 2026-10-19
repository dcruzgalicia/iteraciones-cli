import { logWarning } from './logger.js';

const BIN = 'minify';

let available: boolean | null = null;

async function minifyAvailable(): Promise<boolean> {
  if (available !== null) return available;
  available = await Bun.spawn([BIN, '-l'], { stdout: 'ignore', stderr: 'ignore' })
    .exited.then((code) => code === 0)
    .catch(() => false);
  return available;
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
  const proc = Bun.spawn([BIN, '--type', 'html', '--html-keep-quotes'], {
    stdin: new Blob([html]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [salida, error] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) {
    logWarning(`minify falló; el HTML sale sin minificar. stderr: ${error.trim()}`, 'html');
    return html;
  }
  return salida;
}
