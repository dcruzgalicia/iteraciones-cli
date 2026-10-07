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

export const XMP_FIELDS: { key: keyof PdfXmpMetadata; tag: string; fm: string | null; kind: 'str' | 'list' }[] = [
  { key: 'title', tag: 'Title', fm: 'title', kind: 'str' },
  { key: 'authors', tag: 'Author', fm: 'creator', kind: 'list' },

  { key: 'lang', tag: 'Language', fm: null, kind: 'str' },

  { key: 'subject', tag: 'Subject', fm: 'subject', kind: 'str' },
  { key: 'dateIso', tag: 'Date', fm: 'date', kind: 'str' },
  { key: 'publishers', tag: 'Publisher', fm: 'publisher', kind: 'list' },
  { key: 'keywords', tag: 'Keywords', fm: 'keywords', kind: 'list' },
  { key: 'description', tag: 'Description', fm: 'description', kind: 'str' },
  { key: 'contributors', tag: 'Contributor', fm: 'contributor', kind: 'list' },
  { key: 'identifier', tag: 'Identifier', fm: 'identifier', kind: 'str' },
  { key: 'source', tag: 'Source', fm: 'source', kind: 'str' },
  { key: 'relations', tag: 'Relation', fm: 'relation', kind: 'list' },
  { key: 'coverage', tag: 'Coverage', fm: 'coverage', kind: 'str' },
  { key: 'rights', tag: 'Rights', fm: 'rights', kind: 'str' },
  { key: 'license', tag: 'License', fm: 'license', kind: 'str' },
];

export function buildXmpdataContent(meta: PdfXmpMetadata): string {
  const lines: (string | null)[] = [];
  for (const { key, tag, kind } of XMP_FIELDS) {
    const value = meta[key];
    lines.push(kind === 'list' ? xmpListField(tag, value as string[] | undefined) : xmpStringField(tag, value as string | undefined));
  }

  lines.push(meta.doi ? `\\Identifier{doi:${escapeXmpValue(meta.doi)}}` : null);
  lines.push(meta.isbn ? `\\Identifier{ISBN:${escapeXmpValue(meta.isbn)}}` : null);
  const filled = lines.filter((line): line is string => line !== null);
  return filled.length === 0 ? '' : `${filled.join('\n')}\n`;
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
