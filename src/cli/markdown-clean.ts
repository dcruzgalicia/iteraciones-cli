import { join, resolve } from 'node:path';
import { listMarkdownDocuments } from '../builder/discover-files.js';
import { STRIP_TYPOGRAPHIC_FILTER } from '../builder/filter-resolver.js';
import { espaciosNormales, writeIfChanged } from '../builder/pipeline-io.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logInfo, logSuccess, runCommand } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { relativeLabel } from '../lib/paths.js';
import { plural } from '../lib/plural.js';

export interface MarkdownCleanOptions {
  check?: boolean;
}

export async function limpiaMarkdown(file: string, content: string): Promise<string> {
  const { yaml, body } = splitFrontmatter(content);
  if (body.trim() === '') return content;
  const limpio = await execPandoc({
    input: espaciosNormales(body),
    sourcePath: file,
    from: MD_READER,
    to: 'markdown',
    extraArgs: ['--lua-filter', STRIP_TYPOGRAPHIC_FILTER],
  });
  const cuerpo = espaciosNormales(limpio).replace(/^\n+/, '');
  const conSalto = cuerpo.endsWith('\n') ? cuerpo : `${cuerpo}\n`;
  if (yaml === undefined) return conSalto;
  return `---\n${yaml}\n---\n\n${conSalto}`;
}

export async function runMarkdownClean(cwd: string, args: string[], options: MarkdownCleanOptions = {}): Promise<void> {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: el cuerpo se movió tal cual a runCommand
  await runCommand('clean-markdown', async () => {
    const archivos = args.length > 0 ? args.map((ruta) => resolve(cwd, ruta)) : (await listMarkdownDocuments(cwd)).map((rel) => join(cwd, rel));
    if (archivos.length === 0) throw new BuildError('no hay archivos markdown que limpiar');

    const pendientes: string[] = [];
    let limpios = 0;
    for (const archivo of archivos) {
      const original = await Bun.file(archivo).text();
      const limpio = await limpiaMarkdown(archivo, original);
      if (limpio === original) continue;
      limpios += 1;
      if (options.check) {
        pendientes.push(relativeLabel(cwd, archivo));
        continue;
      }
      await writeIfChanged(archivo, limpio);
    }

    if (options.check) {
      if (pendientes.length === 0) {
        logSuccess('markdown ya limpio', 'clean-markdown');
        return;
      }
      logInfo(`se limpiarían ${plural(pendientes.length, 'archivo')}: ${pendientes.join(', ')}`, 'clean-markdown');
      process.exitCode = 1;
      return;
    }

    if (limpios === 0) {
      logSuccess('markdown ya limpio', 'clean-markdown');
      return;
    }
    logSuccess(`${plural(limpios, 'markdown limpio', 'markdown limpios')} de ${archivos.length}`, 'clean-markdown');
  });
}
