import type { SiteConfig } from '../config/config-schema.js';
import { fmString } from '../lib/frontmatter-fields.js';
import { minifyHtml } from '../lib/minify.js';
import { type BibOptions, execPandoc, imagePathsEnv, MD_READER } from '../lib/pandoc-runner.js';
import { resolveScriptStdout } from '../lib/script-recorder.js';
import { type LuaFilterGroup, loadFilterGroups, luaFilterArgs, STRIP_TYPOGRAPHIC_FILTER } from './filter-resolver.js';
import { buildFormatsArgs, type HtmlDocType, type HtmlPageVars } from './html-composer.js';
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
    { key: 'collection-creator-prefix', value: vars.collectionCreatorPrefix },
    { key: 'author-names', value: vars.authors },
    { key: 'collection-creator-names', value: vars.collectionCreator },
  ]);
  if (!vars.subject) args.push('--metadata=subject:');
  const bandas: Array<[string, string | undefined]> = [
    ['hero', vars.hero],
    ['style', vars.style ?? 'clasico'],
    ['label-formatos', vars.labelFormatos],
    ['label-indice', vars.labelIndice],
    ['label-referencias', vars.labelReferencias],
    ['doc-chip', vars.docChip],
    ['doc-chip-href', vars.docChipHref],
    ['content-chip', vars.contentChip],
    ['icon-top', vars.iconTop],
    ['front-cover', vars.frontCover],
    ['front-cover-alt', vars.frontCoverAlt],
    ['back-cover', vars.backCover],
    ['creator-image', vars.creatorImage],
    ['creator-image-alt', vars.creatorImageAlt],
    ['license', vars.license],
    ['menu-header', vars.menuHeader],
    ['menu-footer-plain', vars.menuFooterPlain],
    ['collection-chips', vars.collectionChips],
    ['keyword-chips', vars.keywordChips],
    ['announcements-top', vars.announcementsTop],
    ['announcements-bottom', vars.announcementsBottom],
    ['indice-coleccion', vars.indiceColeccion],
    ['extras', vars.extras],
    ['sidebar-extras', vars.sidebarExtras],
    ['recientes', vars.recientes],
    ['site-keywords', vars.siteKeywords],
    ['pagination', vars.pagination],
    ['social-meta', vars.socialMeta],
    ['json-ld', vars.jsonLd],
    ['publication-meta', vars.publicationMeta],
    ['citation-block', vars.citationBlock],
  ];
  for (const [clave, valor] of bandas) {
    if (valor) args.push(`--variable=${clave}:${valor}`);
  }
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
      { key: 'meta-description', value: vars.metaDescription },
      { key: 'canonical', value: vars.canonical },
      { key: 'doc-title', value: vars.docTitle },
      { key: 'subtitle', value: vars.subtitle },
      { key: 'date', value: vars.date },
      { key: 'date-iso', value: vars.dateIso },
      { key: 'show-dates', value: vars.showDates ? 'true' : undefined },
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

  if (formats.length > 0) args.push('--variable=formats:1');
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
  extraArgs.push(...luaFilterArgs([...filters.semantic, STRIP_TYPOGRAPHIC_FILTER, ...filters.user, ...filters.flags, ...filters.html]));
  extraArgs.push(...citationCompileArgs(bibOptions?.bibliography, bibOptions?.csl));

  const html = await execPandoc({
    input: espaciosNormales(content),
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'html5',
    extraArgs,
    env: imagePathsEnv(opts.imagePaths),
    inputTarget: opts.inputTarget,
  });
  const final = await minifyHtml(postProcessHtml(html, refsCardTemplate, vars.labelReferencias));

  const postArgv =
    final !== html && opts.scriptOutputPath !== undefined
      ? ['iteraciones', 'post', 'html', '--type', opts.docType ?? 'file', '-o', opts.scriptOutputPath]
      : undefined;
  resolveScriptStdout(html, opts.scriptOutputPath, final, postArgv);
  return final;
}
