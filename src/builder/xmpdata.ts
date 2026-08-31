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

export function buildXmpdataContent(meta: PdfXmpMetadata): string {
  const lines: string[] = [];
  if (meta.title) lines.push(`\\Title{${escapeXmpValue(meta.title)}}`);
  if (meta.authors && meta.authors.length > 0) lines.push(`\\Author{${meta.authors.map(escapeXmpValue).join('\\sep ')}}`);
  if (meta.lang) lines.push(`\\Language{${escapeXmpValue(meta.lang)}}`);
  if (meta.subject) lines.push(`\\Subject{${escapeXmpValue(meta.subject)}}`);
  if (meta.dateIso) lines.push(`\\Date{${escapeXmpValue(meta.dateIso)}}`);
  if (meta.publishers && meta.publishers.length > 0) lines.push(`\\Publisher{${meta.publishers.map(escapeXmpValue).join('\\sep ')}}`);
  if (meta.keywords && meta.keywords.length > 0) lines.push(`\\Keywords{${meta.keywords.map(escapeXmpValue).join('\\sep ')}}`);
  if (meta.description) lines.push(`\\Description{${escapeXmpValue(meta.description)}}`);
  if (meta.contributors && meta.contributors.length > 0) lines.push(`\\Contributor{${meta.contributors.map(escapeXmpValue).join('\\sep ')}}`);
  if (meta.identifier) lines.push(`\\Identifier{${escapeXmpValue(meta.identifier)}}`);
  if (meta.source) lines.push(`\\Source{${escapeXmpValue(meta.source)}}`);
  if (meta.relations && meta.relations.length > 0) lines.push(`\\Relation{${meta.relations.map(escapeXmpValue).join('\\sep ')}}`);
  if (meta.coverage) lines.push(`\\Coverage{${escapeXmpValue(meta.coverage)}}`);
  if (meta.rights) lines.push(`\\Rights{${escapeXmpValue(meta.rights)}}`);
  if (meta.license) lines.push(`\\License{${escapeXmpValue(meta.license)}}`);
  if (meta.doi) lines.push(`\\Identifier{doi:${escapeXmpValue(meta.doi)}}`);
  if (meta.isbn) lines.push(`\\Identifier{ISBN:${escapeXmpValue(meta.isbn)}}`);
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
