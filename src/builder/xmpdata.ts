/**
 * Metadatos descriptivos del documento para el pipeline PDF: el archivo lateral
 * `<jobname>.xmpdata` (que pdfx lee para rellenar el XMP) y el Info dict (que
 * listan todos los lectores de PDF). Ambos se inyectan directamente en el .tex
 * compilado (issue #1970), de modo que el .tex de dist/ queda autocontenido.
 */
export interface PdfXmpMetadata {
  /** Título efectivo (sin el fallback 'Sin título': si no existe, se omite). */
  title?: string;
  /** Autores (dc:creator). */
  authors?: string[];
  /** Idioma efectivo (BCP-47) para dc:language. */
  lang?: string;
  /** Fecha ISO (yyyy-mm-dd) para dc:date. */
  dateIso?: string;
  /** Asunto (dc:subject). */
  subject?: string;
  /** Editoriales (dc:publisher, valores múltiples con \sep). */
  publishers?: string[];
  /** Palabras clave (pdf:Keywords). */
  keywords?: string[];
  /** Descripción (dc:description). */
  description?: string;
  /** Contribuidores (dc:contributor). */
  contributors?: string[];
  /** Identificador (dc:identifier). */
  identifier?: string;
  /** Fuente (dc:source). */
  source?: string;
  /** Relaciones (dc:relation). */
  relations?: string[];
  /** Cobertura (dc:coverage). */
  coverage?: string;
  /** Derechos (dc:rights). */
  rights?: string;
  /** Licencia (xmpRights:WebStatement). */
  license?: string;
  /** DOI. */
  doi?: string;
  /** ISBN. */
  isbn?: string;
  /** Resumen (no soportado por pdfx, se omite del XMP). */
  abstract?: string;
}

/**
 * Escapes TeX dentro de un valor .xmpdata. pdfx solo acepta el resto de ASCII
 * tal cual (prohibe '%', '{', '}' y '\'); los escapes estándar (\{ \} \% \& \#
 * \_ \$ ...) se resuelven al construir el XMP.
 */
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

/**
 * Contenido de `<jobname>.xmpdata`: el archivo lateral que el paquete pdfx lee
 * con `\InputIfFileExists{\jobname.xmpdata}` para rellenar el XMP descriptivo
 * del PDF. Solo se emiten los campos presentes (el template omite los vacíos).
 */
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
  // abstract no es soportado por pdfx, se omite del XMP
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * Tabla de conversión de caracteres Unicode a comandos LaTeX de acentos.
 * Usada para el Info dict (`\pdfescapestring`): pdftex expande los comandos
 * y escribe el byte T1/Latin-1 correcto, en vez del multibyte UTF-8 que
 * produciría un carácter crudo (y que los lectores de PDF interpretan como
 * Latin-1, causando mojibake).
 */
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

/**
 * Convierte caracteres non-ASCII a comandos LaTeX de acentos para que
 * `\pdfescapestring` produzca el byte Latin-1 correcto en el Info dict.
 * Los caracteres ASCII pasan sin cambios; los no mapeados se dejan crudos
 * (fallback seguro para scripts que no estén en la tabla).
 */
function latexAccentEncode(value: string): string {
  return value.replace(/./gu, (ch) => LATEX_ACCENT_MAP[ch] ?? ch);
}

/**
 * Normaliza un valor antes de `\pdfescapestring` (que escapa `( ) \` y espacios)
 * y convierte caracteres non-ASCII a comandos LaTeX para encoding correcto
 * en el Info dict (Latin-1, no UTF-8 multibyte).
 */
function toPdfInfoValue(value: string): string {
  return latexAccentEncode(value.replace(/[\r\n\t]+/g, ' '));
}

/**
 * Bloque `\AtBeginDocument{\pdfinfo{...}}` para el Info dict del PDF. pdfx ya
 * rellena /Title y /Subject (UTF-16BE) desde el .xmpdata pero omite /Author y
 * /Keywords con autores o claves múltiples: aquí se añaden solo esos dos con
 * `\pdfescapestring` (visible para cualquier lector, sin duplicar las claves
 * que ya escribe pdfx) — issue #1970.
 */
export function buildPdfInfoBlock(meta: PdfXmpMetadata): string {
  const entries: string[] = [];
  if (meta.authors && meta.authors.length > 0) entries.push(`/Author (\\pdfescapestring{${toPdfInfoValue(meta.authors.join(', '))}})`);
  if (meta.keywords && meta.keywords.length > 0) entries.push(`/Keywords (\\pdfescapestring{${toPdfInfoValue(meta.keywords.join(', '))}})`);
  if (meta.rights) entries.push(`/Rights (\\pdfescapestring{${toPdfInfoValue(meta.rights)}})`);
  if (meta.license) entries.push(`/License (\\pdfescapestring{${toPdfInfoValue(meta.license)}})`);
  if (entries.length === 0) return '';
  return `\\AtBeginDocument{%\n  \\pdfinfo{%\n${entries.map((e) => `    ${e}%`).join('\n')}\n  }%\n}%\n`;
}

/**
 * Inyecta los metadatos en el .tex compilado, justo antes de `\begin{document}`:
 *
 * - `\begin{filecontents}[overwrite]{\jobname.xmpdata}` escribe el archivo que
 *   pdfx lee en `\begin{document}` (el .tex de dist/ queda autocontenido);
 * - `\AtBeginDocument{\pdfinfo{...}}` fija el Info dict para todos los lectores.
 *
 * pdfx solo consume el .xmpdata si el paquete está cargado (gate en el llamador).
 */
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
