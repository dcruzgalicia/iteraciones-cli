import { basename, dirname, join, relative, sep } from 'node:path';
import { resolveCollectionFile } from '../builder/collection-files.js';
import { loadSlugIndex } from '../builder/discover.js';
import { applyCreatorTitle } from '../builder/discover-frontmatter.js';
import { assembleExportDocument } from '../builder/export/assemble.js';
import { printFlags } from '../builder/image-flags.js';
import { rewriteFmImagePaths } from '../builder/image-processor.js';
import { mergeConfigImages, preprocessDocumentImages } from '../builder/latex-composer.js';
import { aggregateCollectionCreators } from '../builder/orchestrator.js';
import { ASSETS_IMAGES_DIR } from '../builder/output-layout.js';
import { collectionBaseContent, getCreatorLinks, memberSlugMap, readCollectionEntries, writeDistMarkdown } from '../builder/pipeline-formats.js';
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
  const fm = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  // mismos campos derivados que aplica el discovery del build (#2445)
  applyCreatorTitle(fm);
  return fm;
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
 * Misma pasada de imágenes del build: da el mapa de rutas de assets/images y
 * deja escritos esos ficheros por si el .sh los necesita a mano. Divergir aquí
 * reescribiría las imágenes con medidas distintas a las de la fase de recursos.
 * El prefijo del nombre lo decide el outSlug, que el build deriva del `-o`.
 */
async function distImageMap(
  cwd: string,
  siteConfig: Awaited<ReturnType<typeof loadSiteConfig>>,
  content: string,
  fm: Record<string, unknown>,
  entries: Awaited<ReturnType<typeof readCollectionEntries>>,
  assetsDir: string,
  inputPath: string,
  outSlug: string,
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
    outSlug,
  );
  const relImageMap = new Map(
    [...images.imageMap].filter(([src, dst]) => dst !== src).map(([src, dst]): [string, string] => [src, `./${ASSETS_IMAGES_DIR}/${basename(dst)}`]),
  );
  return { relImageMap, docDir: dirname(inputPath) };
}

/**
 * #2445/#2452 — `iteraciones markdown <origen> -o <salida>` escribe el markdown de
 * dist (#2436) con el mismo composit que usa `emitCollectionMarkdown`: frontmatter
 * con las imágenes apuntando a assets/images, `files[]` reescrito hacia el `.md`
 * standalone de cada miembro (su nombre-nuevo) y, si `format.markdown.merge` está
 * activo, el cuerpo fusionado con `type: file`. La salida es idéntica a la del build.
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
    // #2446: igual que el build, el byline de una collection es la unión de los
    // creator de files[]; con merge:false writeDistMarkdown lo vuelve a quitar,
    // porque files[] sigue ahí para recalcularlo.
    if (fm.type === 'collection') fm.creator = await aggregateCollectionCreators({ files: rootFiles }, cwd);
    const entries = rootFiles.length > 0 ? await readCollectionEntries(rootFiles, relativePath, [cwd, join(cwd, dir)]) : [];
    // #2452: el nombre de dist de cada miembro sale de su slug. El build lo
    // saca de su discovery; aquí se replican con el mismo código para que los
    // dos escriban byte a byte el mismo files[] (equivalencia build --full ≡
    // bash build.sh), colisiones y sufijos `-dN` incluidos.
    const memberSlugs = rootFiles.length > 0 ? memberSlugMap(rootFiles, await loadSlugIndex(cwd)) : undefined;
    // El outSlug del build es el nombre del propio `-o`: con el mismo prefijo,
    // las imágenes que escribe este comando se llaman igual que las del build.
    const { relImageMap, docDir } = await distImageMap(
      cwd,
      siteConfig,
      content,
      fm,
      entries,
      join(dirname(output), ASSETS_IMAGES_DIR),
      inputPath,
      basename(output, '.md'),
    );

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
    logError(err instanceof Error ? err.message : String(err), 'markdown');
    process.exitCode = 1;
  }
}
