import type { SiteConfig } from '../config/config-schema.js';
import { fmString } from '../lib/frontmatter-fields.js';
import { minifyHtml } from '../lib/minify.js';
import { type BibOptions, execPandoc, imagePathsEnv, MD_READER } from '../lib/pandoc-runner.js';
import { resolveScriptStdout } from '../lib/script-recorder.js';
import { type LuaFilterGroup, loadFilterGroups } from './filter-resolver.js';
import { buildFormatsArgs, buildFormatsFlag, type HtmlPageVars } from './html-composer.js';
import { postProcessHtml } from './html-postprocess.js';
import { citationCompileArgs, metadataArgs } from './pandoc-metadata.js';
import type { BuildDocument } from './types.js';

interface HtmlPageOptions {
  cwd: string;

  inputTarget?: string;

  imagePaths?: string;
  vars: HtmlPageVars;
  siteConfig: SiteConfig;
  templatePath: string;

  refsCardTemplate: string;

  docType?: 'file' | 'collection' | 'creator';
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
  return args;
}

function buildHtmlMetadataArgs(
  templatePath: string,
  vars: HtmlPageVars,
  lang: string,
  siteTitle: string,
  tagline: string,
  theme: string,
  accent: string,
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
      { key: 'accent', value: accent },
      { key: 'css', value: css },
      { key: 'author-meta', value: vars.authorMeta },
    ]),
  );
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
  const accent = fmString(fm.accent, vars.accent ?? '');
  const css = fmString(fm.css, vars.css ?? '');
  const tocActive = typeof fm.toc === 'boolean' ? fm.toc : siteConfig.toc;

  const extraArgs = buildHtmlMetadataArgs(templatePath, vars, lang, siteTitle, tagline, theme, accent, css, tocActive);
  extraArgs.push('--shift-heading-level-by=4');
  if (tocActive) extraArgs.push('--toc-depth=6');
  for (const filter of [...filters.semantic, ...filters.user, ...filters.flags, ...filters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  extraArgs.push(...citationCompileArgs(bibOptions?.bibliography, bibOptions?.csl));

  const html = await execPandoc({
    input: content,
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
