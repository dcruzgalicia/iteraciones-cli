import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExportDocument } from '../builder/export/types.js';
import type { PdfFormatConfig } from '../config/site-config.js';
import { ConfigError, PandocError } from '../errors.js';

/** Ruta base al directorio de templates LaTeX de exportación, relativa a este archivo. */
const TEMPLATES_DIR = join(import.meta.dir, '../../pandoc/export');

/** Ruta absoluta al directorio de fuentes TTF del proyecto. */
const FONTS_DIR = join(import.meta.dir, '../../fonts');

/**
 * Mapa de nombres estándar de page-size a opciones de clase KOMA-Script.
 *
 * Los sufijos `*paper` (letterpaper, a4paper, …) funcionan en cualquier clase
 * estándar y en KOMA-Script. Para tamaños sin equivalente directo
 * (`half-letter`, `pocket`) se usa la sintaxis `paper=ancho:alto` —
 * KOMA-Script la entiende y aplica las dimensiones correctas.
 */
const STANDARD_PAGE_SIZES: Record<string, string> = {
  'half-letter': 'paper=13.97cm:21.59cm',
  letter: 'letterpaper',
  legal: 'legalpaper',
  executive: 'executivepaper',
  a3: 'a3paper',
  a4: 'a4paper',
  a5: 'a5paper',
  b4: 'b4paper',
  b5: 'b5paper',
  tabloid: 'tabloidpaper',
  pocket: 'paper=10.5cm:17.6cm',
};

/** Regex para tamaño de página personalizado: `"ancho,alto"` con unidades LaTeX (cm, mm, in, pt). */
const CUSTOM_PAGE_SIZE_RE = /^(\d+(?:\.\d+)?(?:cm|mm|in|pt)),(\d+(?:\.\d+)?(?:cm|mm|in|pt))$/;

/** Archivos de fuente que se embeben en los EPUB generados. */
const EPUB_EMBED_FONTS: readonly string[] = [
  join(FONTS_DIR, 'Exo2-VariableFont_wght.ttf'),
  join(FONTS_DIR, 'Exo2-Italic-VariableFont_wght.ttf'),
  join(FONTS_DIR, 'SpaceMono-Regular.ttf'),
  join(FONTS_DIR, 'SpaceMono-Bold.ttf'),
  join(FONTS_DIR, 'SpaceMono-Italic.ttf'),
  join(FONTS_DIR, 'SpaceMono-BoldItalic.ttf'),
];

/**
 * Resuelve la ruta al template LaTeX usando el tipo del documento.
 *
 * Cadena de resolución (primera ruta existente):
 *   1. {cwd}/pandoc/export/{type}.latex  — override local
 *   2. built-in pandoc/export/{type}.latex
 *
 * Si ninguna ruta existe, lanza ConfigError.
 */
function resolveLatexTemplatePath(type: string, cwd?: string): string {
  if (cwd) {
    const p = join(cwd, 'pandoc', 'export', `${type}.latex`);
    if (existsSync(p)) return p;
  }
  const builtin = join(TEMPLATES_DIR, `${type}.latex`);
  if (existsSync(builtin)) return builtin;

  throw new ConfigError(`Template LaTeX '${type}.latex' no encontrado en ${TEMPLATES_DIR}`, builtin);
}

/**
 * Resuelve la hoja de estilos CSS para EPUB usando el tipo del documento como eje primario.
 *
 * Cadena de resolución (primera ruta existente):
 *   1. {cwd}/pandoc/export/{type}.epub.css  — override local por tipo
 *   2. built-in pandoc/export/{type}.epub.css
 *
 * Si ninguna ruta existe, lanza ConfigError.
 */
function resolveEpubCssPath(type: string, cwd?: string): string {
  const filename = `${type}.epub.css`;
  if (cwd) {
    const p = join(cwd, 'pandoc', 'export', filename);
    if (existsSync(p)) return p;
  }
  const builtin = join(TEMPLATES_DIR, filename);
  if (existsSync(builtin)) return builtin;

  throw new ConfigError(`Stylesheet EPUB '${filename}' no encontrado en ${TEMPLATES_DIR}`, builtin);
}

/**
 * Construye el bloque YAML de metadatos que Pandoc inyectará en el documento.
 * Pandoc acepta un bloque YAML al inicio del documento delimitado por `---`.
 */
function buildYamlHeader(doc: ExportDocument, fontdir?: string, pdfFormat?: PdfFormatConfig): string {
  const { metadata } = doc;
  const lines: string[] = ['---'];

  lines.push(`title: ${yamlString(metadata.title)}`);

  if (metadata.author.length > 0) {
    if (metadata.author.length === 1) {
      lines.push(`author: ${yamlString(metadata.author[0] ?? '')}`);
    } else {
      lines.push('author:');
      for (const a of metadata.author) {
        lines.push(`  - ${yamlString(a)}`);
      }
    }
  }

  if (metadata.date) lines.push(`date: ${yamlString(metadata.date)}`);
  lines.push(`lang: ${metadata.lang}`);
  lines.push(`documentclass: ${metadata.documentclass}`);
  if (metadata.toc) lines.push('toc: true');
  if (metadata.tocDepth !== undefined && metadata.tocDepth > 0) {
    lines.push(`toc-depth: ${metadata.tocDepth}`);
  }

  // Hyphenation: permite desactivar guiones en la salida PDF vía configuración
  lines.push(`hyphenation-active: ${pdfFormat?.hyphenation !== false ? 'true' : 'false'}`);

  // Metadatos editoriales opcionales
  if (metadata.isbn) lines.push(`isbn: ${yamlString(metadata.isbn)}`);
  if (metadata.publisher) lines.push(`publisher: ${yamlString(metadata.publisher)}`);
  if (metadata.description) lines.push(`description: ${yamlString(metadata.description)}`);
  if (metadata.rights) lines.push(`rights: ${yamlString(metadata.rights)}`);
  if (metadata.cover) lines.push(`cover-image: ${yamlString(metadata.cover)}`);
  if (metadata.bibliography) lines.push(`bibliography: ${yamlString(metadata.bibliography)}`);
  // Validar existencia del CSL: si el archivo no existe, pandoc fallaría silenciosamente.
  if (metadata.csl) {
    if (existsSync(metadata.csl)) {
      lines.push(`csl: ${yamlString(metadata.csl)}`);
    } else {
      process.stderr.write(`[export] archivo CSL no encontrado: "${metadata.csl}"\n`);
    }
  }

  // Metadatos académicos opcionales
  if (metadata.abstract) lines.push(`abstract: ${yamlString(metadata.abstract)}`);
  if (metadata.keywords && metadata.keywords.length > 0) {
    lines.push('keywords:');
    for (const kw of metadata.keywords) {
      lines.push(`  - ${yamlString(kw)}`);
    }
  }

  // Layout editorial (desde format.pdf)
  if (pdfFormat) {
    // ── Tamaño de página ────────────────────────────────────────────────────
    let geometryEmitted = false;
    if (pdfFormat.pageSize) {
      const classOption = STANDARD_PAGE_SIZES[pdfFormat.pageSize];
      if (classOption) {
        // Tamaño estándar → opción de clase (letterpaper, paper=13.97cm:21.59cm, …)
        lines.push('classoption:');
        lines.push(`  - ${classOption}`);
      } else {
        const customMatch = CUSTOM_PAGE_SIZE_RE.exec(pdfFormat.pageSize);
        if (customMatch) {
          const [, pw, ph] = customMatch;
          if (pdfFormat.margins) {
            // Tamaño personalizado + márgenes → geometry con paperwidth/paperheight
            lines.push('geometry:');
            const [top, right, bottom, left] = pdfFormat.margins;
            lines.push(`  - top=${top}`);
            lines.push(`  - right=${right}`);
            lines.push(`  - bottom=${bottom}`);
            lines.push(`  - left=${left}`);
            lines.push(`  - paperwidth=${pw}`);
            lines.push(`  - paperheight=${ph}`);
            geometryEmitted = true;
          } else {
            // Tamaño personalizado sin márgenes → vars top-level (template usa $if(paperwidth)$)
            lines.push(`paperwidth: ${pw}`);
            lines.push(`paperheight: ${ph}`);
          }
        }
      }
    }
    if (pdfFormat.margins && !geometryEmitted) {
      // Márgenes sin page-size o con page-size estándar → geometry con márgenes únicamente
      lines.push('geometry:');
      const [top, right, bottom, left] = pdfFormat.margins;
      lines.push(`  - top=${top}`);
      lines.push(`  - right=${right}`);
      lines.push(`  - bottom=${bottom}`);
      lines.push(`  - left=${left}`);
    }

    if (pdfFormat.fontSize) lines.push(`fontsize: ${pdfFormat.fontSize}`);
    if (pdfFormat.fontFamily) {
      // Si la fuente es la misma que el default del template (TeX Gyre Pagella),
      // no emitir mainfont para que el template use la rama $else$ con los OTF
      // embebidos en fonts/. Si es otra fuente, emitir mainfont para system lookup.
      if (pdfFormat.fontFamily !== 'TeX Gyre Pagella') {
        lines.push(`mainfont: ${yamlString(pdfFormat.fontFamily)}`);
      }
    }
    if (pdfFormat.lineSpacing !== undefined) lines.push(`linestretch: ${pdfFormat.lineSpacing}`);
    if (pdfFormat.numbering !== undefined) lines.push(`secnumdepth: ${pdfFormat.numbering ? 3 : -2}`);
    if (pdfFormat.pageNumber) {
      const [placement, align] = pdfFormat.pageNumber.split('-') as [string, string];
      lines.push(`pageno-head: ${placement === 'header' ? 'true' : 'false'}`);
      if (pdfFormat.sides === 'twoside') {
        const twosideMap: Record<string, string> = { left: 'LO,RE', center: 'CE,CO', right: 'LE,RO' };
        lines.push(`pageno-fancy: ${twosideMap[align] ?? 'LE,RO'}`);
      } else {
        const alignMap: Record<string, string> = { left: 'L', center: 'C', right: 'R' };
        lines.push(`pageno-fancy: ${alignMap[align] ?? 'R'}`);
      }
    } else if (pdfFormat.sides === 'twoside') {
      // Sin page-number explícito: footer-right por defecto → LE,RO en twoside
      lines.push('pageno-fancy: LE,RO');
    }
    if (pdfFormat.sides) {
      lines.push(`twoside: ${pdfFormat.sides === 'twoside' ? 'true' : 'false'}`);
    }
  }

  // Ruta al directorio de fuentes para fontspec (templates LaTeX con $fontdir$).
  // Solo se incluye en el flujo de PDF; en EPUB causaría un leak de rutas locales.
  if (fontdir) lines.push(`fontdir: ${yamlString(fontdir)}`);

  lines.push('---', '');
  return lines.join('\n');
}

/**
 * Escapa un valor de cadena para un campo en YAML, siempre entre comillas dobles.
 * Citar siempre evita falsos positivos con tokens especiales de YAML: `true`,
 * `false`, `null`, `~`, números, `yes`/`no`, etc., que pandoc reinterpretaría
 * como booleanos, nulos o enteros en lugar de cadenas.
 */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Convierte un ExportDocument a EPUB3 usando pandoc.
 * El documento se pasa a pandoc por stdin con un YAML header.
 *
 * @param doc        Documento ensamblado listo para exportar.
 * @param outputPath Ruta absoluta del archivo EPUB de salida.
 * @param cwd        Directorio raíz del proyecto; permite buscar templates de override locales.
 */
export async function convertToEpub(doc: ExportDocument, outputPath: string, cwd?: string, pdfFormat?: PdfFormatConfig): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const input = buildYamlHeader(doc, undefined, pdfFormat) + doc.body;
  const args = ['pandoc', '--from', 'markdown', '--to', 'epub3', '--output', outputPath];

  // Hoja de estilos resuelta por tipo: {type}.epub.css con fallback a epub.css global.
  args.push('--css', resolveEpubCssPath(doc.type, cwd));
  for (const fontFile of EPUB_EMBED_FONTS) {
    args.push('--epub-embed-font', fontFile);
  }

  if (doc.metadata.cover) {
    args.push('--epub-cover-image', doc.metadata.cover);
  }

  // Activar el procesador de citas cuando hay bibliografía declarada.
  // Sin --citeproc, las citas [@referencia] quedan sin resolver en el documento final.
  if (doc.metadata.bibliography) {
    args.push('--citeproc');
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, doc.filePath, '');
  }

  const [, stderr, exitCode] = await writeAndWait(proc, input, doc.filePath);
  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al generar EPUB para ${doc.filePath}`, doc.filePath, stderr);
  }
}

/**
 * Convierte un ExportDocument a PDF usando pandoc con el motor LaTeX indicado.
 * Usa el template KOMA-Script del directorio `pandoc/export/`.
 *
 * @param doc        Documento ensamblado listo para exportar.
 * @param outputPath Ruta absoluta del archivo PDF de salida.
 * @param engine     Motor LaTeX: 'xelatex' (por defecto) o 'lualatex'.
 * @param cwd        Directorio raíz del proyecto; permite buscar templates de override locales.
 */
export async function convertToPdf(doc: ExportDocument, outputPath: string, cwd?: string, pdfFormat?: PdfFormatConfig): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const templatePath = resolveLatexTemplatePath(doc.type, cwd);
  const input = buildYamlHeader(doc, FONTS_DIR, pdfFormat) + doc.body;
  const args = [
    'pandoc',
    '--from',
    'markdown',
    '--to',
    'pdf',
    '--pdf-engine',
    pdfFormat?.engine ?? 'xelatex',
    `--template=${templatePath}`,
    '--top-level-division=chapter',
    '--output',
    outputPath,
  ];

  // Activar el procesador de citas cuando hay bibliografía declarada.
  // Sin --citeproc, las citas [@referencia] quedan sin resolver en el PDF final.
  if (doc.metadata.bibliography) {
    args.push('--citeproc');
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, doc.filePath, '');
  }

  const [, stderr, exitCode] = await writeAndWait(proc, input, doc.filePath);
  if (exitCode !== 0) {
    // Filtrar la salida de xelatex/lualatex para mostrar solo los errores relevantes.
    const filteredLines = filterLatexStderr(stderr);
    throw new PandocError(`pandoc/LaTeX falló al generar PDF para ${doc.filePath}`, doc.filePath, filteredLines || stderr);
  }
}

/** Escribe al stdin del proceso y espera su terminación. Retorna [stdout, stderr, exitCode]. */
async function writeAndWait(proc: ReturnType<typeof Bun.spawn>, input: string, sourcePath: string): Promise<[string, string, number]> {
  if (proc.stdin == null || typeof proc.stdin === 'number') {
    throw new PandocError('No se pudo escribir stdin de pandoc', sourcePath, '');
  }
  proc.stdin.write(input);
  proc.stdin.end();

  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new PandocError('No se pudo leer stdout de pandoc', sourcePath, '');
  }
  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new PandocError('No se pudo leer stderr de pandoc', sourcePath, '');
  }

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return [stdout, stderr, exitCode];
}

/**
 * Filtra y mejora la salida stderr de LaTeX para mostrar errores accionables.
 *
 * - Detecta paquetes faltantes (`File 'X.sty' not found`) y sugiere `tlmgr install X`
 *   (sin límite de líneas: cada paquete faltante genera una línea de sugerencia)
 * - Extrae errores TeX reales (líneas con `! ` o `l.`) limitados a 25 líneas
 *
 * @param stderr  Salida stderr completa de pandoc/LaTeX.
 */
function filterLatexStderr(stderr: string): string {
  const lines = stderr.split('\n');
  const output: string[] = [];

  // Detectar paquetes faltantes: "! LaTeX Error: File 'paquete.sty' not found."
  // xelatex imprime esto como un error TeX estándar.
  const missingPackages = new Set<string>();
  for (const line of lines) {
    const match = /File '([^']+)\.sty' not found/.exec(line);
    if (match) {
      const pkg = match[1];
      if (pkg) missingPackages.add(pkg);
    }
  }

  if (missingPackages.size > 0) {
    output.push(`[LaTeX] Paquetes faltantes detectados. Instálalos con:`);
    for (const pkg of missingPackages) {
      output.push(`  tlmgr install ${pkg}`);
    }
    output.push('');
  }

  // Extraer errores TeX reales limitando a 25 líneas.
  const texErrors = lines
    .filter((line) => line.startsWith('! ') || line.startsWith('l.') || (line.includes('Error') && !line.includes('rerunfilecheck')))
    .slice(0, 25);

  if (texErrors.length > 0) {
    output.push(...texErrors);
  }

  return output.join('\n');
}
