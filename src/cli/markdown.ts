import { basename, dirname, join, relative, sep } from 'node:path';
import { resolveCollectionFile } from '../builder/collection-files.js';
import { assembleExportDocument } from '../builder/export/assemble.js';
import { printFlags } from '../builder/image-flags.js';
import { rewriteFmImagePaths } from '../builder/image-processor.js';
import { mergeConfigImages, preprocessDocumentImages } from '../builder/latex-composer.js';
import { collectionBaseContent, getCreatorLinks, readCollectionEntries, writeDistMarkdown } from '../builder/pipeline-formats.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logError, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

/**
 * El nivel del documento dentro del proyecto (`.`, `posts`, `a/b`): la salida
 * vive en `<outputDir>/<nivel>/<slug>.md`, así que a partir de `-o` se recupera
 * la raíz de dist que hace falta para reescribir files[] y copiar los miembros.
 */
function outputRootFor(output: string, dir: string): string {
  const outDir = dirname(output);
  const root = dir === '.' ? outDir : outDir.slice(0, outDir.length - dir.length - 1);
  if (join(root, dir) !== outDir) throw new BuildError(`-o debe vivir en el mismo nivel que el origen ("${dir}")`);
  return root;
}

function sourceFm(text: string): Record<string, unknown> {
  const { yaml } = splitFrontmatter(text);
  const parsed = yaml === undefined ? undefined : (Bun.YAML.parse(yaml) ?? undefined);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** files[] de la collection, resueltos contra la raíz (#2443) como en el build. */
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

/**
 * Misma pasada de imágenes del build: da el mapa de rutas de assets/img y deja
 * escritos esos ficheros por si el .sh los necesita a mano. Divergir aquí
 * reescribiría las imágenes con medidas distintas a las de la fase de recursos.
 */
async function distImageMap(
  cwd: string,
  siteConfig: Awaited<ReturnType<typeof loadSiteConfig>>,
  content: string,
  fm: Record<string, unknown>,
  entries: Awaited<ReturnType<typeof readCollectionEntries>>,
  assetsDir: string,
  inputPath: string,
): Promise<{ relImageMap: Map<string, string>; docDir: string }> {
  const flags = await printFlags(siteConfig, cwd);
  const doc = { filePath: inputPath, relativePath: relative(cwd, inputPath), frontmatter: fm } as unknown as BuildDocument;
  const images = await preprocessDocumentImages(
    collectionBaseContent(entries, 'latex', content),
    doc,
    mergeConfigImages(fm, siteConfig.format?.pdf, siteConfig, cwd),
    flags.pageDimensions,
    flags.cropActive,
    flags.pdfxActive,
    assetsDir,
  );
  const relImageMap = new Map(
    [...images.imageMap].filter(([src, dst]) => dst !== src).map(([src, dst]): [string, string] => [src, `./assets/img/${basename(dst)}`]),
  );
  return { relImageMap, docDir: dirname(inputPath) };
}

/**
 * #2445 — `iteraciones markdown <origen> -o <salida>` escribe el markdown de
 * dist (#2436) con el mismo composit que usa `emitCollectionMarkdown`: frontmatter
 * con las imágenes apuntando a assets/img, `files[]` reescrito hacia las copias
 * de los miembros y, si `format.markdown.merge` está activo, el cuerpo fusionado
 * con `type: file`. La salida es idéntica a la del build.
 */
export async function runMarkdown(cwd: string, input: string, options: { output?: string }): Promise<void> {
  try {
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica la ruta del .md de salida');
    }
    const inputPath = resolvePath(cwd, input);
    const relativePath = relative(cwd, inputPath).split(sep).join('/');
    let content: string;
    try {
      content = await Bun.file(inputPath).text();
    } catch {
      throw new BuildError(`no se pudo leer "${input}"`);
    }

    const fm = sourceFm(content);
    const output = resolvePath(cwd, options.output);
    const siteConfig = await loadSiteConfig(cwd);
    const dir = dirname(relativePath);
    const rootFiles = await collectionFiles(cwd, relativePath, fm, input);
    const entries = rootFiles.length > 0 ? await readCollectionEntries(rootFiles, relativePath, [cwd, join(cwd, dir)]) : [];
    const { relImageMap, docDir } = await distImageMap(cwd, siteConfig, content, fm, entries, join(dirname(output), 'assets/img'), inputPath);

    await writeDistMarkdown({
      cwd,
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
      merge: fm.type === 'collection' && siteConfig.format?.markdown?.merge === true,
      entries,
    });
    logSuccess(`${input} → ${options.output}`, 'markdown');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'markdown');
    process.exitCode = 1;
  }
}
