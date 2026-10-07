import { join } from 'node:path';
import { writeIfChanged } from '../builder/pipeline-io.js';
import { composeTemplate, loadLogoInline, TEMPLATE_KINDS, type TemplateKind, templatePathFor } from '../builder/pipeline-setup.js';
import { resolveDisabledPreambleForBuild } from '../builder/preamble-loader.js';
import { resolveBibOptions } from '../builder/state-bib.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { BuildError } from '../lib/errors.js';
import { fail, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

const KINDS = TEMPLATE_KINDS as readonly string[];

export async function runTemplate(cwd: string, kind: string, options: { output?: string }): Promise<void> {
  try {
    if (!KINDS.includes(kind)) throw new BuildError(`tipo de plantilla desconocido "${kind}"; esperado: ${KINDS.join(' | ')}`);
    const siteConfig = await loadSiteConfig(cwd);
    const { bibFiles } = await resolveBibOptions(cwd, siteConfig);

    const effectiveDisabledPreamble = resolveDisabledPreambleForBuild(siteConfig, bibFiles);
    const content = await composeTemplate(kind as TemplateKind, {
      cwd,
      siteConfig,
      bibFiles,
      effectiveDisabledPreamble,
      logoInline: await loadLogoInline(cwd, siteConfig.format?.html?.site?.logo?.trim()),
    });
    const output =
      options.output === undefined || options.output === ''
        ? templatePathFor(kind as TemplateKind, join(cwd, '.iteraciones', 'templates'))
        : resolvePath(cwd, options.output);
    await writeIfChanged(output, content);
    logSuccess(`${kind} → ${output}`, 'template');
  } catch (err) {
    fail('template', err);
  }
}
