export interface PdfXmpMetadata {
  title?: string;
  authors?: string[];
  lang?: string;
  dateIso?: string;
  subject?: string;
  publishers?: string[];
  keywords?: string[];
  description?: string;
  contributors?: string[];
  identifier?: string;
  source?: string;
  relations?: string[];
  coverage?: string;
  rights?: string;
  license?: string;
  doi?: string;
  isbn?: string;
  abstract?: string;
}

const XMP_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  _: '\\_',
  $: '\\$',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};

function escapeXmpValue(value: string): string {
  return value.replace(/[\\{}%&#_$^~]/g, (ch) => XMP_ESCAPES[ch] ?? ch);
}

function xmpStringField(tag: string, value: string | undefined): string | null {
  return value ? `\\${tag}{${escapeXmpValue(value)}}` : null;
}

function xmpListField(tag: string, values: string[] | undefined): string | null {
  return values && values.length > 0 ? `\\${tag}{${values.map(escapeXmpValue).join('\\sep ')}}` : null;
}

export function buildXmpdataContent(meta: PdfXmpMetadata): string {
  const lines: string[] = [];
  for (const line of [
    xmpStringField('Title', meta.title),
    xmpListField('Author', meta.authors),
    xmpStringField('Language', meta.lang),
    xmpStringField('Subject', meta.subject),
    xmpStringField('Date', meta.dateIso),
    xmpListField('Publisher', meta.publishers),
    xmpListField('Keywords', meta.keywords),
    xmpStringField('Description', meta.description),
    xmpListField('Contributor', meta.contributors),
    xmpStringField('Identifier', meta.identifier),
    xmpStringField('Source', meta.source),
    xmpListField('Relation', meta.relations),
    xmpStringField('Coverage', meta.coverage),
    xmpStringField('Rights', meta.rights),
    xmpStringField('License', meta.license),
    meta.doi ? `\\Identifier{doi:${escapeXmpValue(meta.doi)}}` : null,
    meta.isbn ? `\\Identifier{ISBN:${escapeXmpValue(meta.isbn)}}` : null,
  ]) {
    if (line) lines.push(line);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

const LATEX_ACCENT_MAP: Record<string, string> = {
  á: "\\'{a}",
  é: "\\'{e}",
  í: "\\'{i}",
  ó: "\\'{o}",
  ú: "\\'{u}",
  Á: "\\'{A}",
  É: "\\'{E}",
  Í: "\\'{I}",
  Ó: "\\'{O}",
  Ú: "\\'{U}",
  ñ: '\\~{n}',
  Ñ: '\\~{N}',
  ü: '\\"{u}',
  Ü: '\\"{U}',
};

function latexAccentEncode(value: string): string {
  return value.replace(/./gu, (ch) => LATEX_ACCENT_MAP[ch] ?? ch);
}

function toPdfInfoValue(value: string): string {
  return latexAccentEncode(value.replace(/[\r\n\t]+/g, ' '));
}

export function buildPdfInfoBlock(meta: PdfXmpMetadata): string {
  const entries: string[] = [];
  if (meta.authors && meta.authors.length > 0) entries.push(`/Author (\\pdfescapestring{${toPdfInfoValue(meta.authors.join(', '))}})`);
  if (meta.keywords && meta.keywords.length > 0) entries.push(`/Keywords (\\pdfescapestring{${toPdfInfoValue(meta.keywords.join(', '))}})`);
  if (meta.rights) entries.push(`/Rights (\\pdfescapestring{${toPdfInfoValue(meta.rights)}})`);
  if (meta.license) entries.push(`/License (\\pdfescapestring{${toPdfInfoValue(meta.license)}})`);
  if (entries.length === 0) return '';
  return `\\AtBeginDocument{%\n  \\pdfinfo{%\n${entries.map((e) => `    ${e}%`).join('\n')}\n  }%\n}%\n`;
}

export function injectXmpMetadataIntoLatex(tex: string, meta: PdfXmpMetadata): string {
  const xmpdata = buildXmpdataContent(meta);
  const pdfinfo = buildPdfInfoBlock(meta);
  if (!xmpdata && !pdfinfo) return tex;
  const blocks: string[] = [];
  if (xmpdata) {
    blocks.push(`\\begin{filecontents}[overwrite]{\\jobname.xmpdata}\n${xmpdata}\\end{filecontents}\n`);
  }
  if (pdfinfo) blocks.push(pdfinfo);
  const anchor = '\\begin{document}';
  const idx = tex.indexOf(anchor);
  if (idx === -1) return tex;
  return `${tex.slice(0, idx)}${blocks.join('\n')}${tex.slice(idx)}`;
}
