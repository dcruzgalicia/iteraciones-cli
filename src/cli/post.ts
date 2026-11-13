import { dirname, join, relative, resolve } from 'node:path';
import type { HtmlDocType } from '../builder/html-composer.js';
import { addResponsiveImages, loadReferencesCardTemplate, postProcessHtml } from '../builder/html-postprocess.js';
import type { ImageVariant } from '../builder/image-processor.js';
import { composeLatexFinalOutput, type LatexPostManifest } from '../builder/latex-composer.js';
import { writeOutput } from '../builder/pipeline-io.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { BuildError } from '../lib/errors.js';
import { logSuccess, runCommand } from '../lib/logger.js';
import { minifyHtml } from '../lib/minify.js';

const POST_KINDS = ['html', 'latex'] as const;

async function readStdin(): Promise<string> {
  return new Response(Bun.stdin).text();
}

function postHtmlType(raw: string): HtmlDocType {
  return raw === 'collection' || raw === 'creator' ? raw : 'file';
}

async function postHtml(raw: string, type: string, cwd: string, output: string): Promise<string> {
  const config = await loadSiteConfig(cwd);
  const variantsPath = join(cwd, '.iteraciones', 'variants', `${relative(cwd, output)}.json`);
  const variants = (await Bun.file(variantsPath)
    .json()
    .catch(() => undefined)) as Record<string, ImageVariant[]> | undefined;
  const html = postProcessHtml(raw, await loadReferencesCardTemplate(postHtmlType(type)), config.format?.html?.site?.labels?.referencias);
  return minifyHtml(addResponsiveImages(html, variants === undefined ? undefined : new Map(Object.entries(variants))));
}

async function postLatex(raw: string, post: string | undefined, cwd: string, output: string): Promise<string> {
  if (post === undefined || post === '') {
    throw new BuildError('falta --post: ruta del manifiesto .iteraciones/post/<slug>.json');
  }
  let manifest: LatexPostManifest;
  try {
    manifest = JSON.parse(await Bun.file(resolve(cwd, post)).text()) as LatexPostManifest;
  } catch {
    throw new BuildError(`no se pudo leer el manifiesto "${post}"`);
  }
  const texDir = dirname(output);
  return await composeLatexFinalOutput(raw, manifest, texDir);
}

export async function runPost(cwd: string, kind: string, options: { output: string; post?: string; type?: string }): Promise<void> {
  await runCommand('post', async () => {
    if (!(POST_KINDS as readonly string[]).includes(kind)) {
      throw new BuildError(`tipo de post-proceso desconocido "${kind}"; esperado: ${POST_KINDS.join(' | ')}`);
    }
    const output = resolve(cwd, options.output);
    const raw = await readStdin();
    if (raw === '') throw new BuildError('entrada vacía por stdin');

    await writeOutput(
      output,
      kind === 'html' ? await postHtml(raw, options.type ?? 'file', cwd, output) : await postLatex(raw, options.post, cwd, output),
    );
    logSuccess(`${kind} → ${options.output}`, 'post');
  });
}
