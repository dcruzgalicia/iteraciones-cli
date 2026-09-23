import { dirname, isAbsolute, join, normalize } from 'node:path';
import { convertToMarkdown } from '../builder/export/runner.js';
import { buildCollectionSectionsMarkdown, readCollectionEntries } from '../builder/pipeline-formats.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logError, logSuccess } from '../lib/logger.js';

async function readSourceFm(inputPath: string, label: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await Bun.file(inputPath).text();
  } catch {
    throw new BuildError(`no se pudo leer "${label}"`);
  }
  const { yaml } = splitFrontmatter(text);
  if (yaml === undefined) return {};
  try {
    return Bun.YAML.parse(yaml) as Record<string, unknown>;
  } catch {
    throw new BuildError(`frontmatter inválido en "${label}"`);
  }
}

function assertCollectionFiles(fm: Record<string, unknown>, label: string): string[] {
  if (fm.type !== 'collection') {
    throw new BuildError(`"${label}" no es una colección (type: ${typeof fm.type === 'string' ? fm.type : 'sin type'})`);
  }
  const files = Array.isArray(fm.files) ? fm.files.filter((f): f is string => typeof f === 'string') : [];
  if (files.length === 0) throw new BuildError(`"${label}": la collection no tiene archivos en files`);
  return files;
}

/**
 * #2437: `iteraciones merge <collection.md> -o <out.md>` fusiona los
 * archivos de files[] en un solo markdown con type: file (sin files[]).
 * Los files se resuelven relativos al .md de entrada: dist reescribe
 * files[] para apuntar a las copias de los miembros emitidas allí.
 */
export async function runMerge(cwd: string, input: string, options: { output?: string }): Promise<void> {
  try {
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica la ruta del .md fusionado de salida');
    }
    const inputPath = isAbsolute(input) ? normalize(input) : join(cwd, normalize(input));
    const fm = await readSourceFm(inputPath, input);
    const files = assertCollectionFiles(fm, input);
    const entries = await readCollectionEntries(files, dirname(inputPath), input);
    if (entries.length === 0) throw new BuildError(`"${input}": los archivos de files no tienen contenido`);

    const output = isAbsolute(options.output) ? normalize(options.output) : join(cwd, options.output);
    const loaded = await loadSiteConfigIfPresent(cwd);
    const doc = {
      filePath: inputPath,
      relativePath: input,
      metadata: { title: '', creator: [], language: loaded?.config.language ?? DEFAULT_SITE_CONFIG.language, toc: false },
    };
    await convertToMarkdown(buildCollectionSectionsMarkdown(entries), output, doc, fm, true);
    logSuccess(`${input} → ${options.output}`, 'merge');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'merge');
    process.exitCode = 1;
  }
}
