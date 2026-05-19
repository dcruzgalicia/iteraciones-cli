import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExportDocument } from '../builder/export/types.js';
import { PandocError } from '../errors.js';

/** Ruta base al directorio de templates LaTeX de exportación, relativa a este archivo. */
const TEMPLATES_DIR = join(import.meta.dir, '../../pandoc/export');

/**
 * Construye el bloque YAML de metadatos que Pandoc inyectará en el documento.
 * Pandoc acepta un bloque YAML al inicio del documento delimitado por `---`.
 */
function buildYamlHeader(doc: ExportDocument): string {
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

  const templatePath = join(TEMPLATES_DIR, `${doc.metadata.documentclass}.latex`);
  const input = buildYamlHeader(doc) + doc.body;
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
    // Filtrar la salida de xelatex para mostrar solo los errores de TeX reales.
    const texErrors = stderr
      .split('\n')
      .filter((line) => line.startsWith('! ') || line.startsWith('l.') || line.includes('Error'))
      .slice(0, 20)
      .join('\n');
    throw new PandocError(`pandoc/LaTeX falló al generar PDF para ${doc.filePath}`, doc.filePath, texErrors || stderr);
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
