import { isAbsolute, relative } from 'node:path';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { BuildError } from '../lib/errors.js';
import { fail, logError, logInfo, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import { analyzePdf, type TypographyIncidence } from '../lib/pdf-typography.js';
import { plural } from '../lib/plural.js';
import { mapWithConcurrency } from '../lib/run.js';
import { listPdfFiles } from '../lib/visual-diff.js';

export interface TypographyOptions {
  output?: string;
  json?: boolean;
}

/** Rango de páginas del PDF, 1 como en el PDF y ambos extremos incluidos. */
export interface RangoPaginas {
  desde?: number;
  hasta?: number;
}

const SOLO_NUMERO = /^\d+$/;

/**
 * Separa rutas y rango. Un argumento que sea sólo dígitos es una página, todo lo demás es
 * ruta: un archivo llamado libro.pdf nunca se confunde con un folio, y un rango suelto
 * (typography 80) revisa desde la 80 en todos los PDF de --output.
 */
export function separaRango(args: string[]): { paths: string[]; rango: RangoPaginas } {
  const paths: string[] = [];
  const numeros: string[] = [];
  for (const arg of args) {
    if (SOLO_NUMERO.test(arg)) numeros.push(arg);
    else paths.push(arg);
  }
  if (numeros.length > 2) {
    throw new BuildError(`el rango acepta como mucho dos números (desde y hasta) y llegaron ${numeros.length}: ${numeros.join(' ')}`);
  }
  const desde = numeros[0] === undefined ? undefined : Number(numeros[0]);
  const hasta = numeros[1] === undefined ? undefined : Number(numeros[1]);
  if (desde === 1 && hasta === undefined) {
    // "typography libro.pdf 1" no recorta nada; es más probable un fallo de dedo que una intención.
    throw new BuildError('la página 1 es la primera: para revisar todo el PDF, quita el rango');
  }
  if (desde !== undefined && desde < 1) throw new BuildError(`la página ${desde} no existe: las páginas empiezan en 1`);
  if (desde !== undefined && hasta !== undefined && hasta < desde) {
    throw new BuildError(`el rango ${desde}-${hasta} va al revés: la página final no puede ser anterior a la inicial`);
  }
  return { paths, rango: { desde, hasta } };
}

function etiqueta(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

function formatea(incidencia: TypographyIncidence): string {
  const texto = incidencia.text.trimEnd();
  if (incidencia.type === 'consecutive-punctuation') {
    return `  pág ${incidencia.page}  líneas ${incidencia.previousLine}-${incidencia.line}  ${incidencia.type}\n         ${incidencia.previousLine}  ${incidencia.previousText.trimEnd()}\n         ${incidencia.line}  ${texto}`;
  }
  return `  pág ${incidencia.page}  línea ${incidencia.line}  ${incidencia.type}  ${texto}`;
}

export async function runTypography(cwd: string, args: string[], options: TypographyOptions = {}): Promise<void> {
  try {
    const { paths, rango } = separaRango(args);
    const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
    const targets = paths.length > 0 ? paths.map((path) => resolvePath(cwd, path)) : await listPdfFiles(outputDir);
    if (targets.length === 0) throw new BuildError(`no hay PDFs en ${etiqueta(cwd, outputDir)}`);

    const desde = rango.desde ?? 1;
    const files = await mapWithConcurrency(targets, 4, async (pdf) => ({
      pdf,
      incidences: await analyzePdf(pdf, desde, rango.hasta),
    }));
    const total = files.reduce((sum, file) => sum + file.incidences.length, 0);

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          ok: total === 0,
          files: files.map((file) => ({ pdf: etiqueta(cwd, file.pdf), incidences: file.incidences })),
        })}\n`,
      );
      if (total > 0) process.exitCode = 1;
      return;
    }

    if (total === 0) {
      logSuccess(`sin incidencias en ${plural(targets.length, 'PDF')}`, 'typography');
      return;
    }
    const lineas: string[] = [];
    for (const { pdf, incidences } of files) {
      if (incidences.length === 0) continue;
      lineas.push(`${etiqueta(cwd, pdf)} · ${plural(incidences.length, 'incidencia')}`);
      lineas.push(...incidences.map(formatea));
    }
    logInfo(lineas.join('\n'), 'typography');
    process.exitCode = 1;
    logError(`${plural(total, 'incidencia')} en ${plural(files.length, 'PDF')}`, 'typography');
  } catch (err) {
    fail('typography', err);
  }
}
