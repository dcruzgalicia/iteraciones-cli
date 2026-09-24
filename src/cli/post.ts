import { dirname, join } from 'node:path';
import { loadReferencesCardTemplate, postProcessHtml } from '../builder/html-postprocess.js';
import { type LatexPostManifest, postProcessLatex } from '../builder/latex-composer.js';
import { writeOutput } from '../builder/pipeline-io.js';
import { BuildError } from '../lib/errors.js';
import { logError, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

/** Los post-procesos disponibles; el build graba el mismo argv. */
export const POST_KINDS = ['html', 'latex'] as const;

/** stdin → stdout es el molde de todo `iteraciones post`; el build lo graba así. */
async function readStdin(): Promise<string> {
  return new Response(Bun.stdin).text();
}

async function postHtml(raw: string): Promise<string> {
  // misma tarjeta de referencias que el build, leída del paquete
  return postProcessHtml(raw, await loadReferencesCardTemplate());
}

/**
 * Autores, XMP y distribución de imágenes: datos que solo el build calcula, así
 * que viajan en `.iteraciones/post/<slug>.json`. Las imágenes terminan
 * compartiendo directorio con el .tex, como en el build.
 */
async function postLatex(raw: string, post: string | undefined, cwd: string, output: string): Promise<string> {
  if (post === undefined || post === '') {
    throw new BuildError('falta --post: ruta del manifiesto .iteraciones/post/<slug>.json');
  }
  let manifest: LatexPostManifest;
  try {
    manifest = JSON.parse(await Bun.file(resolvePath(cwd, post)).text()) as LatexPostManifest;
  } catch {
    throw new BuildError(`no se pudo leer el manifiesto "${post}"`);
  }
  for (const [abs, name] of Object.entries(manifest.distribution ?? {})) {
    if (await Bun.file(abs).exists()) await Bun.write(join(dirname(output), name), Bun.file(abs));
  }
  return postProcessLatex(raw, manifest);
}

/**
 * #2445 — fase de post-proceso: aplica solo lo que difiere de la salida cruda
 * de pandoc. El .sh hace `pandoc > crudo` y luego `iteraciones post <tipo>
 * < crudo -o dist`, con el mismo código que usó el build.
 */
export async function runPost(cwd: string, kind: string, options: { output?: string; post?: string }): Promise<void> {
  try {
    if (!(POST_KINDS as readonly string[]).includes(kind)) {
      throw new BuildError(`tipo de post-proceso desconocido "${kind}"; esperado: ${POST_KINDS.join(' | ')}`);
    }
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica la ruta del archivo de salida');
    }
    const output = resolvePath(cwd, options.output);
    const raw = await readStdin();
    if (raw === '') throw new BuildError('entrada vacía por stdin');

    await writeOutput(output, kind === 'html' ? await postHtml(raw) : await postLatex(raw, options.post, cwd, output));
    logSuccess(`${kind} → ${options.output}`, 'post');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'post');
    process.exitCode = 1;
  }
}
