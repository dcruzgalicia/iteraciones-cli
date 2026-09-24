import { isAbsolute, join, normalize } from 'node:path';
import { loadReferencesCardTemplate, postProcessHtml } from '../builder/html-postprocess.js';
import { writeOutput } from '../builder/pipeline-io.js';
import { BuildError } from '../lib/errors.js';
import { logError, logSuccess } from '../lib/logger.js';

/** Los post-procesos disponibles; el build graba el mismo argv. */
export const POST_KINDS = ['html'] as const;

/** stdin → stdout es el molde de todo `iteraciones post`; el build lo graba así. */
async function readStdin(): Promise<string> {
  return new Response(Bun.stdin).text();
}

/**
 * #2445 — fase de post-proceso: aplica solo lo que difiere de la salida cruda
 * de pandoc. El .sh hace `pandoc > crudo` y luego `iteraciones post <tipo>
 * < crudo -o dist`, con el mismo código que usó el build.
 */
export async function runPost(cwd: string, kind: string, options: { output?: string }): Promise<void> {
  try {
    if (!(POST_KINDS as readonly string[]).includes(kind)) {
      throw new BuildError(`tipo de post-proceso desconocido "${kind}"; esperado: ${POST_KINDS.join(' | ')}`);
    }
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica la ruta del archivo de salida');
    }
    const output = isAbsolute(options.output) ? normalize(options.output) : join(cwd, normalize(options.output));
    const raw = await readStdin();
    if (raw === '') throw new BuildError('entrada vacía por stdin');

    // misma tarjeta de referencias que el build, leída del paquete
    await writeOutput(output, postProcessHtml(raw, await loadReferencesCardTemplate()));
    logSuccess(`${kind} → ${options.output}`, 'post');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'post');
    process.exitCode = 1;
  }
}
