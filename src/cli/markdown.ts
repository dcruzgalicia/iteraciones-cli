import { basename, dirname, join, relative } from 'node:path';
import { resolveCollectionFile } from '../builder/collection-files.js';
import { loadSlugIndex } from '../builder/discover.js';
import { applyCreatorTitle } from '../builder/discover-frontmatter.js';
import { assembleExportDocument } from '../builder/export.js';

import { rewriteFmImagePaths } from '../builder/image-processor.js';

import { aggregateCollectionCreators } from '../builder/orchestrator.js';
import { ASSETS_IMAGES_DIR } from '../builder/output-layout.js';
import { collectionBaseContent, getCreatorLinks, memberSlugMap, readCollectionEntries, writeDistMarkdown } from '../builder/pipeline-formats.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fail, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import { buildImagesContext, readSourceDocument } from './merge.js';

function outputRootFor(output: string, dir: string): string {
  const outDir = dirname(output);
  const root = dir === '.' ? outDir : outDir.slice(0, outDir.length - dir.length - 1);
  if (join(root, dir) !== outDir) throw new BuildError(`-o debe vivir en el mismo nivel que el origen ("${dir}")`);
  return root;
}

function sourceFm(text: string): Record<string, unknown> {
  const { yaml } = splitFrontmatter(text);
  const parsed = yaml === undefined ? undefined : (Bun.YAML.parse(yaml) ?? undefined);
  const fm = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};

  applyCreatorTitle(fm);
  return fm;
}

async function collectionFiles(cwd: string, relativePath: string, fm: Record<string, unknown>, input: string): Promise<string[]> {
  if (fm.type !== 'collection') return [];
  const raw = Array.isArray(fm.files) ? fm.files.filter((f): f is string => typeof f === 'string') : [];
  const files: string[] = [];
  for (const file of raw) {
    const resolved = await resolveCollectionFile(file, relativePath, cwd);
    if (resolved.ok) files.push(resolved.rootRelative);
  }
  if (files.length === 0) throw new BuildError(`"${input}": la collection no tiene archivos en files`);
  return files;
}

export async function runMarkdown(cwd: string, input: string, options: { output?: string }): Promise<void> {
  try {
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica la ruta del .md de salida');
    }
    const { inputPath, relativePath, text: content } = await readSourceDocument(cwd, input);

    const fm = sourceFm(content);
    const output = resolvePath(cwd, options.output);
    const siteConfig = await loadSiteConfig(cwd);
    const dir = dirname(relativePath);
    const rootFiles = await collectionFiles(cwd, relativePath, fm, input);

    if (fm.type === 'collection') fm.creator = await aggregateCollectionCreators({ files: rootFiles }, cwd);
    const entries = rootFiles.length > 0 ? await readCollectionEntries(rootFiles, relativePath, [cwd, join(cwd, dir)]) : [];

    const memberSlugs = rootFiles.length > 0 ? memberSlugMap(rootFiles, await loadSlugIndex(cwd)) : undefined;

    const { relImageMap, docDir } = await buildImagesContext({
      cwd,
      siteConfig,
      content: collectionBaseContent(entries, 'latex', content),
      fm,
      filePath: inputPath,
      relativePath: relative(cwd, inputPath),
      assetsDir: join(dirname(output), ASSETS_IMAGES_DIR),
      outSlug: basename(output, '.md'),
    });

    await writeDistMarkdown({
      label: relativePath,
      content,
      outPath: output,
      outputDir: outputRootFor(output, dir),
      fm: rewriteFmImagePaths(fm, relImageMap, docDir),
      exportDoc: assembleExportDocument(
        { filePath: inputPath, relativePath, frontmatter: fm } as unknown as BuildDocument,
        siteConfig.language ?? DEFAULT_SITE_CONFIG.language,
        undefined,
        undefined,
        siteConfig.toc,
      ),
      relImageMap,
      docDir,
      creatorLinks: fm.type === 'creator' ? getCreatorLinks(fm) : [],
      rootFiles: fm.type === 'collection' ? rootFiles : undefined,
      memberSlugs,
      merge: fm.type === 'collection' && siteConfig.format?.markdown?.merge === true,
      entries,
    });
    logSuccess(`${input} → ${options.output}`, 'markdown');
  } catch (err) {
    fail('markdown', err);
  }
}
