import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExportDocument } from '../builder/export/types.js';
import { PandocError } from '../errors.js';

/** Ruta base al directorio de templates LaTeX de exportación, relativa a este archivo. */
const TEMPLATES_DIR = join(import.meta.dir, '../../pandoc/export');

/** Ruta absoluta al directorio de fuentes TTF del proyecto. */
const FONTS_DIR = join(import.meta.dir, '../../fonts');

/** Ruta al stylesheet CSS para EPUB. */
const EPUB_STYLE_PATH = join(TEMPLATES_DIR, 'epub.css');

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
 * Variantes de template compatibles con cada documentclass.
 * Si el usuario solicita una variante incompatible con su documentclass se usa el template base.
 */
const VARIANT_CLASS: Readonly<Record<string, 'scrartcl' | 'scrbook'>> = {
  literary: 'scrartcl',
  academic: 'scrartcl',
  anthology: 'scrbook',
  technical: 'scrbook',
};

/**
 * Resuelve la ruta al template LaTeX según el documentclass y la variante solicitada.
 * Si la variante no es compatible con el documentclass, advierte y retorna el template base.
 */
function resolveTemplatePath(documentclass: 'scrartcl' | 'scrbook', variant: string | undefined): string {
  if (variant) {
    if (VARIANT_CLASS[variant] === documentclass) {
      return join(TEMPLATES_DIR, `${documentclass}-${variant}.latex`);
    }
    process.stderr.write(`[export] variante de template "${variant}" no es compatible con ${documentclass}; usando template base.\n`);
  }
  return join(TEMPLATES_DIR, `${documentclass}.latex`);
}

/**
 * Construye el bloque YAML de metadatos que Pandoc inyectará en el documento.
 * Pandoc acepta un bloque YAML al inicio del documento delimitado por `---`.
 */
function buildYamlHeader(doc: ExportDocument, fontdir?: string): string {
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

  // Metadatos editoriales opcionales
  if (metadata.isbn) lines.push(`isbn: ${yamlString(metadata.isbn)}`);
  if (metadata.publisher) lines.push(`publisher: ${yamlString(metadata.publisher)}`);
  if (metadata.description) lines.push(`description: ${yamlString(metadata.description)}`);
  if (metadata.rights) lines.push(`rights: ${yamlString(metadata.rights)}`);
  if (metadata.cover) lines.push(`cover-image: ${yamlString(metadata.cover)}`);
  if (metadata.bibliography) lines.push(`bibliography: ${yamlString(metadata.bibliography)}`);
  if (metadata.csl) lines.push(`csl: ${yamlString(metadata.csl)}`);

  // Metadatos académicos opcionales (usados por el template scrartcl-academic)
  if (metadata.abstract) lines.push(`abstract: ${yamlString(metadata.abstract)}`);
  if (metadata.keywords && metadata.keywords.length > 0) {
    lines.push('keywords:');
    for (const kw of metadata.keywords) {
      lines.push(`  - ${yamlString(kw)}`);
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
 */
export async function convertToEpub(doc: ExportDocument, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const input = buildYamlHeader(doc) + doc.body;
  const args = ['pandoc', '--from', 'markdown', '--to', 'epub3', '--output', outputPath];

  // Hoja de estilos y fuentes embebidas.
  args.push('--css', EPUB_STYLE_PATH);
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
 */
export async function convertToPdf(doc: ExportDocument, outputPath: string, engine: 'xelatex' | 'lualatex'): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const templatePath = resolveTemplatePath(doc.metadata.documentclass, doc.metadata.template);
  const input = buildYamlHeader(doc, FONTS_DIR) + doc.body;
  const args = ['pandoc', '--from', 'markdown', '--to', 'pdf', '--pdf-engine', engine, `--template=${templatePath}`, '--output', outputPath];

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
