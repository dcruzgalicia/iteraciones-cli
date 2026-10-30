import type { SiteConfig } from '../config/config-schema.js';
import { fmString } from '../lib/frontmatter-fields.js';
import { minifyHtml } from '../lib/minify.js';
import { type BibOptions, execPandoc, imagePathsEnv, MD_READER } from '../lib/pandoc-runner.js';
import { resolveScriptStdout } from '../lib/script-recorder.js';
import { type LuaFilterGroup, loadFilterGroups, STRIP_TYPOGRAPHIC_FILTER } from './filter-resolver.js';
import { buildFormatsArgs, buildFormatsFlag, type HtmlDocType, type HtmlPageVars } from './html-composer.js';
import { postProcessHtml } from './html-postprocess.js';
import { citationCompileArgs, metadataArgs } from './pandoc-metadata.js';
import { espaciosNormales } from './pipeline-io.js';
import type { BuildDocument } from './types.js';

interface HtmlPageOptions {
  cwd: string;

  inputTarget?: string;

  imagePaths?: string;
  vars: HtmlPageVars;
  siteConfig: SiteConfig;
  templatePath: string;

  refsCardTemplate: string;

  docType?: HtmlDocType;
  fm: Record<string, unknown>;
  bibOptions?: BibOptions;
  luaFilters?: LuaFilterGroup;

  scriptOutputPath?: string;
}

function metadataBandArgs(vars: HtmlPageVars): string[] {
  const args = metadataArgs([
    { key: 'titlehead', value: vars.titlehead },
    { key: 'subject', value: vars.subject },
    { key: 'publishers', value: vars.publishers },
    { key: 'collection-creator-prefix', value: vars.collectionCreatorPrefix },
    { key: 'author-names', value: vars.authors },
    { key: 'collection-creator-names', value: vars.collectionCreator },
  ]);
  if (vars.docChip) args.push(`--variable=doc-chip:${vars.docChip}`);
  if (vars.docChipHref) args.push(`--variable=doc-chip-href:${vars.docChipHref}`);
  if (vars.contentChip) args.push(`--variable=content-chip:${vars.contentChip}`);
  if (vars.frontCover) args.push(`--variable=front-cover:${vars.frontCover}`);
  if (vars.backCover) args.push(`--variable=back-cover:${vars.backCover}`);
  if (vars.creatorImage) args.push(`--variable=creator-image:${vars.creatorImage}`);
  if (vars.creatorImageAlt) args.push(`--variable=creator-image-alt:${vars.creatorImageAlt}`);
  if (vars.license) args.push(`--variable=license:${vars.license}`);
  if (vars.menu) args.push(`--variable=menu:${vars.menu}`);
  if (vars.announcementsTop) args.push(`--variable=announcements-top:${vars.announcementsTop}`);
  if (vars.announcementsBottom) args.push(`--variable=announcements-bottom:${vars.announcementsBottom}`);
  if (vars.indiceColeccion) args.push(`--variable=indice-coleccion:${vars.indiceColeccion}`);
  if (vars.extras) args.push(`--variable=extras:${vars.extras}`);
  if (vars.pagination) args.push(`--variable=pagination:${vars.pagination}`);
  return args;
}

function buildHtmlMetadataArgs(
  templatePath: string,
  vars: HtmlPageVars,
  lang: string,
  siteTitle: string,
  tagline: string,
  theme: string,
  css: string,
  tocActive: boolean,
): string[] {
  const args = [
    '--template',
    templatePath,
    ...metadataArgs([
      { key: 'title', value: vars.title },
      { key: 'site-title', value: siteTitle },
      { key: 'lang', value: lang },
    ]),
    '--metadata=link-citations:true',
  ];
  if (tocActive) args.push('--toc');
  args.push(
    ...metadataArgs([
      { key: 'tagline', value: tagline },
      { key: 'doc-title', value: vars.docTitle },
      { key: 'subtitle', value: vars.subtitle },
      { key: 'date', value: vars.date },
      { key: 'home-href', value: vars.homeHref },
      { key: 'theme', value: theme },
      { key: 'css', value: css },
      { key: 'keywords', value: vars.keywords },
      { key: 'author-meta', value: vars.authorMeta },
    ]),
  );
  if (vars.logoBlock !== undefined) args.push(`--variable=logo-block:${vars.logoBlock}`);
  if (vars.favicon !== undefined) args.push(`--variable=favicon:${vars.favicon}`);
  args.push(...metadataBandArgs(vars));
  const formats = vars.formats ?? [];

  const formatsFlag = buildFormatsFlag(formats);
  if (formatsFlag !== undefined) args.push(`--variable=formats:${formatsFlag}`);
  args.push(...buildFormatsArgs(formats));
  return args;
}

export async function htmlPageFromMarkdown(content: string, doc: BuildDocument, opts: HtmlPageOptions): Promise<string> {
  const { cwd, vars, siteConfig, templatePath, refsCardTemplate, fm, bibOptions, luaFilters } = opts;
  const filters = luaFilters ?? (await loadFilterGroups(siteConfig, siteConfig.disabledFilters, cwd));
  const lang = fmString(fm.language, vars.lang);
  const siteTitle = fmString(fm['site-title'], vars.siteTitle);
  const tagline = fmString(fm.tagline, vars.tagline ?? '');
  const theme = fmString(fm.theme, vars.theme ?? '');
  const css = fmString(fm.css, vars.css ?? '');
  const tocActive = typeof fm.toc === 'boolean' ? fm.toc : siteConfig.toc;

  const extraArgs = buildHtmlMetadataArgs(templatePath, vars, lang, siteTitle, tagline, theme, css, tocActive);
  extraArgs.push('--shift-heading-level-by=4');
  if (tocActive) extraArgs.push('--toc-depth=6');
  for (const filter of [...filters.semantic, STRIP_TYPOGRAPHIC_FILTER, ...filters.user, ...filters.flags, ...filters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  extraArgs.push(...citationCompileArgs(bibOptions?.bibliography, bibOptions?.csl));

  const html = await execPandoc({
    // En el sitio no hay espacios no separables: son cosa del PDF.
    input: espaciosNormales(content),
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'html5',
    extraArgs,
    env: imagePathsEnv(opts.imagePaths),
    inputTarget: opts.inputTarget,
  });
  const final = await minifyHtml(postProcessHtml(html, refsCardTemplate));

  const postArgv =
    final !== html && opts.scriptOutputPath !== undefined
      ? ['iteraciones', 'post', 'html', '--type', opts.docType ?? 'file', '-o', opts.scriptOutputPath]
      : undefined;
  resolveScriptStdout(html, opts.scriptOutputPath, final, postArgv);
  return final;
}
