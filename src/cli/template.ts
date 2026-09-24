import { isAbsolute, join, normalize } from 'node:path';
import { writeIfChanged } from '../builder/pipeline-io.js';
import { composeTemplate, loadLogoInline, TEMPLATE_KINDS, type TemplateKind, templatePathFor } from '../builder/pipeline-setup.js';
import { resolveEffectiveDisabledPreamble } from '../builder/preamble-loader.js';
import { resolveBibOptions } from '../builder/state-bib.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { resolveDisabledPreambleConfig } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { logError, logSuccess } from '../lib/logger.js';

const KINDS = TEMPLATE_KINDS as readonly string[];

/**
 * #2445 — `iteraciones template <tipo> [-o <ruta>]` escribe una de las
 * plantillas que pandoc recibe por `--template`. El build escribe esas mismas
 * rutas con el mismo compositor: la salida es byte-idéntica, así el build.sh
 * puede regenerar los recursos que su fase de pandoc necesita.
 */
export async function runTemplate(cwd: string, kind: string, options: { output?: string }): Promise<void> {
  try {
    if (!KINDS.includes(kind)) throw new BuildError(`tipo de plantilla desconocido "${kind}"; esperado: ${KINDS.join(' | ')}`);
    const siteConfig = await loadSiteConfig(cwd);
    const { bibFiles } = await resolveBibOptions(cwd, siteConfig);
    const content = await composeTemplate(kind as TemplateKind, {
      cwd,
      siteConfig,
      bibFiles,
      effectiveDisabledPreamble: resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(siteConfig)),
      logoInline: await loadLogoInline(cwd, siteConfig.format?.html?.site?.logo?.trim()),
    });
    const output =
      options.output === undefined || options.output === ''
        ? templatePathFor(kind as TemplateKind, join(cwd, '.iteraciones', 'templates'))
        : isAbsolute(options.output)
          ? normalize(options.output)
          : join(cwd, normalize(options.output));
    await writeIfChanged(output, content);
    logSuccess(`${kind} → ${output}`, 'template');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'template');
    process.exitCode = 1;
  }
}
