import { isAbsolute, relative } from 'node:path';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { BuildError } from '../lib/errors.js';
import { fail, logError, logInfo, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import { analyzePdf, type OpcionesAnalisis, TODAS_LAS_REGLAS, type TypographyIncidence } from '../lib/pdf-typography.js';
import { plural } from '../lib/plural.js';
import { mapWithConcurrency } from '../lib/run.js';
import { listPdfFiles } from '../lib/visual-diff.js';

export interface TypographyOptions {
  output?: string;
  json?: boolean;
  pages?: string;
  minLineWidth?: string;
  rules?: string;
  minLines?: string;
  minLetters?: string;
}

export interface RangoPaginas {
  desde?: number;
  hasta?: number;
}

const RANGO_PAGINAS = /^(\d+)(?:\s*-\s*(\d+))?$/;

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

export function interpretaReglas(spec: string): string[] {
  const pedidas = spec
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (pedidas.length === 0) {
    throw new BuildError(`--rules "${spec}" no trae ninguna regla: escoge entre ${TODAS_LAS_REGLAS.join(', ')}`);
  }
  const desconocidas = pedidas.filter((regla) => !TODAS_LAS_REGLAS.includes(regla as never));
  if (desconocidas.length > 0) {
    throw new BuildError(`no existe la regla ${desconocidas.map((r) => `"${r}"`).join(', ')}. Las que hay son: ${TODAS_LAS_REGLAS.join(', ')}`);
  }
  return pedidas;
}

export function interpretaEntero(valor: string, opcion: string, minimo: number): number {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo) {
    throw new BuildError(`${opcion} "${valor}" no es un entero de ${minimo} en adelante`);
  }
  return numero;
}

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
  if (incidencia.type === 'single-word-line') {
    return `  pág ${incidencia.page}  línea ${incidencia.line}  ${incidencia.type}  ${texto}`;
  }
  const lineas = incidencia.lineas;
  const numeros = lineas.map((l) => l.line);
  const rango =
    numeros.length < 2
      ? `línea ${numeros[0]}`
      : `líneas ${numeros[0]}-${numeros.at(-1)}${incidencia.total > lineas.length ? ` de ${incidencia.total}` : ''}`;
  const cuerpo = lineas.map((l) => `         ${l.line}  ${l.text.trimEnd()}`).join('\n');
  if (incidencia.type === 'repeated-first-letter' || incidencia.type === 'repeated-last-letter') {
    const donde = incidencia.type === 'repeated-first-letter' ? 'empiezan' : 'terminan';
    const letras = JSON.stringify(incidencia.letter).replace(/"/g, "'");
    return `  pág ${incidencia.page}  ${rango}  ${incidencia.type}\n${cuerpo}\n         las ${numeros.length} ${donde} por ${letras}`;
  }
  return `  pág ${incidencia.page}  ${rango}  ${incidencia.type}\n${cuerpo}`;
}

function opcionesDeAnalisis(options: TypographyOptions): OpcionesAnalisis {
  const rango = options.pages === undefined ? {} : interpretaPaginas(options.pages);
  return {
    primeraPagina: rango.desde ?? 1,
    ultimaPagina: rango.hasta,
    porcentajeCorta: options.minLineWidth === undefined ? 100 : interpretaPorcentaje(options.minLineWidth, '--min-line-width'),
    reglas: options.rules === undefined ? TODAS_LAS_REGLAS : interpretaReglas(options.rules),
    lineasMinimas: options.minLines === undefined ? 3 : interpretaEntero(options.minLines, '--min-lines', 2),
    letrasMinimas: options.minLetters === undefined ? 2 : interpretaEntero(options.minLetters, '--min-letters', 1),
  };
}

export async function runTypography(cwd: string, args: string[], options: TypographyOptions = {}): Promise<void> {
  try {
    const analisis = opcionesDeAnalisis(options);
    const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
    const targets = args.length > 0 ? args.map((path) => resolvePath(cwd, path)) : await listPdfFiles(outputDir);
    if (targets.length === 0) throw new BuildError(`no hay PDFs en ${etiqueta(cwd, outputDir)}`);

    const files = await mapWithConcurrency(targets, 4, async (pdf) => ({
      pdf,
      incidences: await analyzePdf(pdf, analisis),
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
