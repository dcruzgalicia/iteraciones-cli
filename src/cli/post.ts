import { dirname } from 'node:path';
import { loadReferencesCardTemplate, postProcessHtml } from '../builder/html-postprocess.js';
import { composeLatexFinalOutput, type LatexPostManifest } from '../builder/latex-composer.js';
import { writeOutput } from '../builder/pipeline-io.js';
import { BuildError } from '../lib/errors.js';
import { fail, logSuccess } from '../lib/logger.js';
import { minifyHtml } from '../lib/minify.js';
import { resolvePath } from '../lib/paths.js';

export const POST_KINDS = ['html', 'latex'] as const;

async function readStdin(): Promise<string> {
  return new Response(Bun.stdin).text();
}

export type PostHtmlType = 'file' | 'collection' | 'creator';

function postHtmlType(raw: string): PostHtmlType {
  return raw === 'collection' || raw === 'creator' ? raw : 'file';
}

async function postHtml(raw: string, type: string): Promise<string> {
  return minifyHtml(postProcessHtml(raw, await loadReferencesCardTemplate(postHtmlType(type))));
}

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
  const texDir = dirname(output);
  return await composeLatexFinalOutput(raw, manifest, texDir);
}

export async function runPost(cwd: string, kind: string, options: { output: string; post?: string; type?: string }): Promise<void> {
  try {
    if (!(POST_KINDS as readonly string[]).includes(kind)) {
      throw new BuildError(`tipo de post-proceso desconocido "${kind}"; esperado: ${POST_KINDS.join(' | ')}`);
    }
    const output = resolvePath(cwd, options.output);
    const raw = await readStdin();
    if (raw === '') throw new BuildError('entrada vacía por stdin');

    await writeOutput(output, kind === 'html' ? await postHtml(raw, options.type ?? 'file') : await postLatex(raw, options.post, cwd, output));
    logSuccess(`${kind} → ${options.output}`, 'post');
  } catch (err) {
    fail('post', err);
  }
}
