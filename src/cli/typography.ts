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
  pages?: string;
  minLineWidth?: string;
}

/** Rango de páginas del PDF, 1 como en el PDF y ambos extremos incluidos. */
export interface RangoPaginas {
  desde?: number;
  hasta?: number;
}

const RANGO_PAGINAS = /^(\d+)(?:\s*-\s*(\d+))?$/;

/**
 * Interpreta --pages: 3 o 3-80, con las dos puntas dentro. Va como flag y no como argumento
 * suelto para no tener que adivinar si un número es una página o el nombre de un archivo,
 * que es justo la ambigüedad que este CLI no quiere.
 */
export function interpretaPaginas(spec: string): RangoPaginas {
  const encontrado = RANGO_PAGINAS.exec(spec.trim());
  if (encontrado === null) {
    throw new BuildError(`--pages "${spec}" no se entiende: escribe 3 para empezar en la 3, o 3-80 para un rango`);
  }
  const desde = Number(encontrado[1]);
  const hasta = encontrado[2] === undefined ? undefined : Number(encontrado[2]);
  if (desde < 1) throw new BuildError(`la página ${desde} no existe: las páginas empiezan en 1`);
  if (desde === 1 && hasta === undefined) {
    throw new BuildError('--pages 1 no recorta nada: para revisar todo el PDF, quita la opción');
  }
  if (hasta !== undefined && hasta < desde) {
    throw new BuildError(`el rango ${desde}-${hasta} va al revés: la página final no puede ser anterior a la inicial`);
  }
  return { desde, hasta };
}

/** Porcentaje del ancho medio por debajo del cual una línea se considera corta. */
export function interpretaPorcentaje(valor: string, opcion: string): number {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0 || numero > 100) {
    throw new BuildError(`${opcion} "${valor}" no es un porcentaje entero entre 0 y 100`);
  }
  return numero;
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
    const rango = options.pages === undefined ? {} : interpretaPaginas(options.pages);
    const porcentajeCorta = options.minLineWidth === undefined ? 100 : interpretaPorcentaje(options.minLineWidth, '--min-line-width');
    const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
    const targets = args.length > 0 ? args.map((path) => resolvePath(cwd, path)) : await listPdfFiles(outputDir);
    if (targets.length === 0) throw new BuildError(`no hay PDFs en ${etiqueta(cwd, outputDir)}`);

    const desde = rango.desde ?? 1;
    const files = await mapWithConcurrency(targets, 4, async (pdf) => ({
      pdf,
      incidences: await analyzePdf(pdf, desde, rango.hasta, porcentajeCorta),
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
