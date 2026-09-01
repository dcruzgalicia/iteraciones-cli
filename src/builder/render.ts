import type { SiteConfig } from '../config/config-schema.js';
import { fmString } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { type BibOptions, execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { type LuaFilterGroup, loadFilterGroups } from './filter-resolver.js';
import { buildFormatsItems, type HtmlPageVars } from './html-composer.js';
import { extractReferencesBlock, removeTocReferencesLink } from './html-postprocess.js';
import { citationCompileArgs, languageArg, metadataValue, titleArg } from './pandoc-metadata.js';
import type { BuildDocument } from './types.js';

interface HtmlPageOptions {
  cwd: string;
  vars: HtmlPageVars;
  siteConfig: SiteConfig;
  templatePath: string;
  refsCardTemplate: string;
  fm: Record<string, unknown>;
  bibOptions?: BibOptions;
  luaFilters?: LuaFilterGroup;
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
    titleArg(vars.title),
    `--metadata=site-title:${metadataValue(siteTitle)}`,
    languageArg(lang, 'lang'),
    '--metadata=link-citations:true',
  ];
  if (tocActive) args.push('--toc');
  if (tagline) args.push(`--metadata=tagline:${metadataValue(tagline)}`);
  if (vars.docTitle) args.push(`--metadata=doc-title:${metadataValue(vars.docTitle)}`);
  if (vars.subtitle) args.push(`--metadata=subtitle:${metadataValue(vars.subtitle)}`);
  if (vars.date) args.push(`--metadata=date:${metadataValue(vars.date)}`);
  if (vars.homeHref) args.push(`--metadata=home-href:${vars.homeHref}`);
  if (theme) args.push(`--metadata=theme:${theme}`);
  if (accent) args.push(`--metadata=accent:${accent}`);
  if (css) args.push(`--metadata=css:${css}`);
  if (vars.authorMeta) args.push(`--metadata=author-meta:${vars.authorMeta}`);
  if (vars.logoInline) args.push(`--variable=logo-inline:${vars.logoInline}`);
  const formatsItems = buildFormatsItems(vars.formats ?? []);
  if (formatsItems) args.push(`--variable=formats:${formatsItems}`);
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

  const html = await execPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'html5', extraArgs });
  const htmlWithoutTocRefs = removeTocReferencesLink(html);
  const { html: htmlWithoutRefs, block: referencesBlock } = extractReferencesBlock(htmlWithoutTocRefs, refsCardTemplate);
  if (referencesBlock && htmlWithoutRefs.includes('<!-- block:referencias -->')) {
    return htmlWithoutRefs.replace('<!-- block:referencias -->', referencesBlock);
  }
  if (referencesBlock) {
    logWarning('la tarjeta de referencias no está en format.html.blocks; la bibliografía no se inserta en la página', 'html');
  }
  return htmlWithoutRefs;
}
