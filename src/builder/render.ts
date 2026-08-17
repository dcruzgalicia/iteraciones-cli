import type { SiteConfig } from '../config/config-schema.js';
import { logWarning } from '../lib/logger.js';
import { type BibOptions, runPandoc } from '../lib/pandoc-runner.js';
import { type LuaFilterGroup, loadFilterGroups } from './filter-resolver.js';
import { buildFormatsBlock, extractReferencesBlock, type HtmlPageVars, MD_READER, metadataValue, removeTocReferencesLink } from './html-composer.js';
import type { BuildDocument } from './types.js';

/**
 * Genera la página HTML completa desde el markdown original en una sola
 * invocación de pandoc (reader markdown + filtros semánticos/de usuario/flags
 * + capa html + template efectivo). Post-procesamiento mínimo: solo las
 * referencias (extraerlas del article y reinsertarlas en su marcador, que es
 * la única forma de sacarlas del body correctamente).
 */
export async function htmlPageFromMarkdown(
  content: string,
  doc: BuildDocument,
  cwd: string,
  vars: HtmlPageVars,
  siteConfig: SiteConfig,
  templatePath: string,
  fm: Record<string, unknown>,
  bibOptions?: BibOptions,
  luaFilters?: LuaFilterGroup,
): Promise<string> {
  const filters = luaFilters ?? (await loadFilterGroups(siteConfig, siteConfig.disabledFilters, cwd));
  // Valores efectivos: el frontmatter del documento manda; la config aporta defaults
  const lang = typeof fm.lang === 'string' && fm.lang ? fm.lang : vars.lang;
  const siteTitle = typeof fm['site-title'] === 'string' && fm['site-title'] ? (fm['site-title'] as string) : vars.siteTitle;
  const tagline = typeof fm.tagline === 'string' && fm.tagline ? (fm.tagline as string) : vars.tagline;
  const theme = typeof fm.theme === 'string' && fm.theme ? (fm.theme as string) : vars.theme;
  const accent = typeof fm.accent === 'string' && fm.accent ? (fm.accent as string) : vars.accent;
  const css = typeof fm.css === 'string' && fm.css ? (fm.css as string) : vars.css;
  // El TOC: el frontmatter (toc:) manda; la config aporta el default
  const tocActive = typeof fm.toc === 'boolean' ? fm.toc : siteConfig.toc;

  const extraArgs = [
    '--template',
    templatePath,
    `--metadata=title:${metadataValue(vars.title)}`,
    `--metadata=site-title:${metadataValue(siteTitle)}`,
    `--metadata=lang:${lang}`,
    '--metadata=link-citations:true',
  ];
  if (tocActive) extraArgs.push('--toc');
  for (const filter of [...filters.semantic, ...filters.user, ...filters.flags, ...filters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (tagline) extraArgs.push(`--metadata=tagline:${metadataValue(tagline)}`);
  if (vars.docTitle) extraArgs.push(`--metadata=doc-title:${metadataValue(vars.docTitle)}`);
  if (vars.subtitle) extraArgs.push(`--metadata=subtitle:${metadataValue(vars.subtitle)}`);
  if (vars.date) extraArgs.push(`--metadata=date:${metadataValue(vars.date)}`);
  if (vars.homeHref) extraArgs.push(`--metadata=home-href:${vars.homeHref}`);
  if (theme) extraArgs.push(`--metadata=theme:${theme}`);
  if (accent) extraArgs.push(`--metadata=accent:${accent}`);
  if (css) extraArgs.push(`--metadata=css:${css}`);
  if (vars.authorMeta) extraArgs.push(`--metadata=author-meta:${vars.authorMeta}`);
  if (vars.logoInline) extraArgs.push(`--variable=logo-inline:${vars.logoInline}`);
  const formatsBlock = buildFormatsBlock(vars.formats ?? []);
  if (formatsBlock) extraArgs.push(`--variable=formats:${formatsBlock}`);

  // citeproc DESPUÉS de --lua-filter (orden protegido por test de regresión)
  if (bibOptions) {
    extraArgs.push('--citeproc', '--bibliography', bibOptions.bibliography);
    if (bibOptions.csl) extraArgs.push('--csl', bibOptions.csl);
  }

  const html = await runPandoc({ input: content, sourcePath: doc.filePath, from: MD_READER, to: 'html5', extraArgs });

  const htmlWithoutTocRefs = removeTocReferencesLink(html);

  const { html: htmlWithoutRefs, block: referencesBlock } = extractReferencesBlock(htmlWithoutTocRefs);
  if (referencesBlock) {
    // La tarjeta referencias puede no estar en format.html.blocks: sin
    // marcador, la bibliografía se descartaría en silencio (regresión
    // detectada en la revisión): el warning lo hace visible.
    if (htmlWithoutRefs.includes('<!-- block:referencias -->')) {
      return htmlWithoutRefs.replace('<!-- block:referencias -->', referencesBlock);
    }
    logWarning('la tarjeta de referencias no está en format.html.blocks; la bibliografía no se inserta en la página', 'html');
    return htmlWithoutRefs;
  }
  return htmlWithoutRefs;
}
