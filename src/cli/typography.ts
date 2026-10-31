import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { slugify } from '../builder/discover.js';
import { listMarkdownDocuments } from '../builder/discover-files.js';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { PKG_PREAMBLE_DIR } from '../builder/preamble-loader.js';
import { BuildError } from '../lib/errors.js';
import { readFrontmatter, splitFrontmatter } from '../lib/frontmatter.js';
import { fail, logError, logInfo, logSuccess, writeJson } from '../lib/logger.js';
import { relativeLabel } from '../lib/paths.js';
import {
  agregaExcepcionesAlTexto,
  analyzePdf,
  nombreCortado,
  type OpcionesAnalisis,
  palabraSinCorte,
  parseaExcepciones,
  TYPOGRAPHY_RULES,
  type TypographyIncidence,
} from '../lib/pdf-typography.js';
import { plural } from '../lib/plural.js';
import { exec, mapWithConcurrency, type RunResult } from '../lib/run.js';
import { listPdfFiles } from '../lib/visual-diff.js';

export interface TypographyOptions {
  output?: string;
  json?: boolean;
  pages?: string;
  rules?: string;
  exceptions?: string;
  ignore?: string | boolean;
  clean?: string | boolean;
  fix?: string | boolean;
}

interface RangoPaginas {
  desde: number;
  hasta: number;
}

const RANGO_PAGINAS = /^(\d+)(?:\s*-\s*(\d+))?$/;

/** Acepta `6`, `6-13` y una lista: `6,7,10,20` o `6-8,10,20-22`. */
function interpretaPaginas(spec: string): RangoPaginas[] {
  const tramos: RangoPaginas[] = [];
  for (const parte of spec.split(',').map((p) => p.trim())) {
    if (parte === '') {
      throw new BuildError(`--pages "${spec}" tiene un hueco: separa las páginas con coma, sin dejar una vacía (3,7 o 6-8,10)`);
    }
    const encontrado = RANGO_PAGINAS.exec(parte);
    if (encontrado === null) {
      if (/^\d+\s*-\s*$/.test(parte)) {
        throw new BuildError(
          `--pages "${parte}" no tiene página final: escribe ${parte.replace(/\s*-\s*$/, '')} para una sola página, o 11-20 para un rango`,
        );
      }
      throw new BuildError(`--pages "${parte}" no se entiende: escribe 3, 3-80 o una lista como 3,7,10 (las dos puntas dentro)`);
    }
    const desde = Number(encontrado[1]);
    const hasta = encontrado[2] === undefined ? desde : Number(encontrado[2]);
    if (desde < 1) throw new BuildError(`la página ${desde} no existe: las páginas empiezan en 1`);
    if (hasta < desde) {
      throw new BuildError(`el rango ${desde}-${hasta} va al revés: la página final no puede ser anterior a la inicial`);
    }
    if (hasta === desde && encontrado[2] !== undefined) {
      throw new BuildError(`el rango ${desde}-${hasta} no es un rango: para una sola página escribe ${desde}`);
    }
    tramos.push({ desde, hasta });
  }
  return tramos;
}

function interpretaReglas(spec: string): string[] {
  const pedidas = spec
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (pedidas.length === 0) {
    throw new BuildError(`--rules "${spec}" no trae ninguna regla: escoge entre ${TYPOGRAPHY_RULES.join(', ')}`);
  }
  const desconocidas = pedidas.filter((regla) => !TYPOGRAPHY_RULES.includes(regla as never));
  if (desconocidas.length > 0) {
    throw new BuildError(`no existe la regla ${desconocidas.map((r) => `"${r}"`).join(', ')}. Las que hay son: ${TYPOGRAPHY_RULES.join(', ')}`);
  }
  return pedidas;
}

/** `3,5`: las incidencias elegidas del informe. */
function seleccionaIncidencias(spec: string, total: number, opcion: string): number[] {
  const partes = spec.split(',').map((parte) => parte.trim());
  if (partes.some((parte) => parte === '')) {
    throw new BuildError(`${opcion} "${spec}" tiene un hueco: separa los números con coma (3,5)`);
  }
  const numeros = partes.map((parte) => {
    const numero = Number(parte);
    if (!Number.isInteger(numero)) throw new BuildError(`${opcion} "${parte}" no es un número de incidencia`);
    return numero;
  });
  const fuera = numeros.find((numero) => numero < 1 || numero > total);
  if (fuera !== undefined) {
    throw new BuildError(`no existe la incidencia ${fuera}: el informe tiene ${plural(total, 'incidencia')}`);
  }
  return [...new Set(numeros)];
}

function formatea(incidencia: TypographyIncidence): string {
  const texto = incidencia.text.trimEnd();
  if (incidencia.type === 'single-word-line') {
    return `  pág ${incidencia.page}  línea ${incidencia.line}  ${incidencia.type}  ${texto}`;
  }
  if (incidencia.type === 'hyphenated-proper-noun') {
    return `  pág ${incidencia.page}  línea ${incidencia.line}  ${incidencia.type}  ${nombreCortado(incidencia)}`;
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

function reportIncidencias(
  cwd: string,
  entradas: { pdf: string; incidences: TypographyIncidence[]; motivo?: (incidencia: TypographyIncidence) => string | undefined }[],
): void {
  const lineas: string[] = [];
  let numero = 0;
  for (const { pdf, incidences, motivo } of entradas) {
    if (incidences.length === 0) continue;
    lineas.push(`${relativeLabel(cwd, pdf)} · ${plural(incidences.length, 'incidencia')}`);
    for (const incidencia of incidences) {
      numero += 1;
      const partes = formatea(incidencia).split('\n');
      partes[0] = `  #${numero}  ${(partes[0] as string).slice(2)}`;
      const porque = motivo?.(incidencia);
      if (porque) partes[0] = `${partes[0]}  ${porque}`;
      lineas.push(partes.join('\n'));
    }
  }
  logInfo(lineas.join('\n'), 'typography');
}

function opcionesDeAnalisis(options: TypographyOptions): OpcionesAnalisis {
  const paginas = options.pages === undefined ? undefined : interpretaPaginas(options.pages);
  return {
    paginas,
    reglas: options.rules === undefined ? TYPOGRAPHY_RULES : interpretaReglas(options.rules),
  };
}

function cargarExcepciones(cwd: string, options: TypographyOptions, crear = false): ReturnType<typeof parseaExcepciones> {
  const ruta = resolve(cwd, options.exceptions ?? '.typography-exceptions');
  let contenido: string | undefined;
  try {
    contenido = readFileSync(ruta, 'utf8');
  } catch (err) {
    const codigo = (err as NodeJS.ErrnoException).code;
    if (codigo !== 'ENOENT') throw err;
    if (options.exceptions !== undefined && !crear) {
      throw new BuildError(`no existe el archivo de excepciones ${relativeLabel(cwd, ruta)}`);
    }
  }
  return contenido === undefined ? [] : parseaExcepciones(contenido);
}

/** `3,5`, lo que entienden --fix y --ignore; cualquier otra cosa es una ruta. */
function esSeleccion(spec: string): boolean {
  return /^\d+(\s*,\s*\d+)*$/.test(spec.trim());
}

export async function runTypography(cwd: string, args: string[], options: TypographyOptions = {}): Promise<void> {
  try {
    // Sin números es todo; si el valor no es una selección, es una ruta que
    // commander se comió al pasar el argumento opcional.
    for (const opcion of ['ignore', 'clean', 'fix'] as const) {
      const valor = options[opcion];
      if (typeof valor === 'string' && !esSeleccion(valor)) {
        args.unshift(valor);
        options[opcion] = true;
      }
    }
    const analisis = opcionesDeAnalisis(options);
    const outputDir = resolve(cwd, options.output ?? DIST_FILES_DIR);
    const targets = args.length > 0 ? args.map((path) => resolve(cwd, path)) : await listPdfFiles(outputDir);
    if (targets.length === 0) throw new BuildError(`no hay PDFs en ${relativeLabel(cwd, outputDir)}`);

    if (options.clean !== undefined && options.clean !== false) {
      if (options.fix !== undefined && options.fix !== false) {
        throw new BuildError('--clean y --fix no se combinan: elige limpiar o corregir');
      }
      const { limpiados, sinLimpiar, porPdf } = await limpiaTypografia(cwd, targets, analisis, options);
      const total = [...porPdf.values()].reduce((suma, item) => suma + item.incidences.length, 0);
      if (total === 0) {
        logSuccess(`sin incidencias en ${plural(targets.length, 'PDF')}`, 'typography');
        return;
      }
      reportIncidencias(
        cwd,
        [...porPdf].map(([pdf, resultado]) => ({
          pdf,
          incidences: resultado.incidences,
          motivo: (incidencia) => resultado.estado.get(incidencia),
        })),
      );
      logInfo(`${limpiados} párrafos limpios de ${total}${sinLimpiar > 0 ? ` · ${sinLimpiar} sin limpiar` : ''}`, 'typography');
      if (sinLimpiar > 0) process.exitCode = 1;
      return;
    }

    if (options.fix !== undefined && options.fix !== false) {
      const { corregidos, sinAplicar, noEncontradas, multiples, noAplica, sinAccion, sinUnion, exactMiss, porPdf } = await arreglaTypografia(
        cwd,
        targets,
        analisis,
        options,
      );
      const total = [...porPdf.values()].reduce((suma, item) => suma + item.incidences.length, 0);
      if (total === 0) {
        logSuccess(`sin incidencias en ${plural(targets.length, 'PDF')}`, 'typography');
        return;
      }
      reportIncidencias(
        cwd,
        targets.map((pdf) => {
          const resultado = porPdf.get(pdf);
          return {
            pdf,
            incidences: resultado?.incidences ?? [],
            motivo: resultado ? (incidencia) => resultado.estado.get(incidencia) : undefined,
          };
        }),
      );
      const partes = [`${corregidos} corregidas de ${total}`];
      const sinCorregir = sinAplicar;
      if (sinCorregir > 0) {
        partes.push(`${sinCorregir} sin corregir`);
        const detalle = [
          noEncontradas > 0 ? `${noEncontradas} no encontradas` : '',
          multiples > 0 ? `${multiples} con múltiples coincidencias` : '',
          noAplica > 0 ? `${noAplica} no aplica (títulos de sección)` : '',
          sinAccion > 0 ? `${sinAccion} sin acción` : '',
          sinUnion > 0 ? `${sinUnion} sin unión pegable` : '',
          exactMiss > 0 ? `${exactMiss} sin coincidencia exacta` : '',
        ].filter(Boolean);
        if (detalle.length > 0) partes.push(`(${detalle.join(', ')})`);
      }
      logInfo(partes.join(' · '), 'typography');
      if (sinAplicar > 0) process.exitCode = 1;
      return;
    }

    const excepciones = cargarExcepciones(cwd, options, options.ignore !== undefined);

    const files = await mapWithConcurrency(targets, 4, async (pdf) => ({
      pdf,
      incidences: await analyzePdf(pdf, { ...analisis, excepciones, archivo: relativeLabel(cwd, pdf) }),
    }));

    if (options.ignore !== undefined) {
      const planas = files.flatMap((file) => file.incidences.map((incidencia) => ({ pdf: file.pdf, incidencia })));
      const numeros =
        typeof options.ignore === 'string' ? seleccionaIncidencias(options.ignore, planas.length, '--ignore') : planas.map((_, indice) => indice + 1);
      if (numeros.length === 0) {
        logSuccess('sin incidencias que guardar', 'typography');
        return;
      }
      const ruta = resolve(cwd, options.exceptions ?? '.typography-exceptions');
      let texto = '';
      try {
        texto = readFileSync(ruta, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      for (const pdf of new Set(numeros.map((numero) => (planas[numero - 1] as { pdf: string }).pdf))) {
        const archivo = relativeLabel(cwd, pdf);
        const elegidas = numeros.map((numero) => planas[numero - 1] as { pdf: string; incidencia: TypographyIncidence });
        const delPdf = elegidas.filter((elegida) => elegida.pdf === pdf).map((elegida) => elegida.incidencia);
        texto = agregaExcepcionesAlTexto(texto, archivo, delPdf);
      }
      writeFileSync(ruta, texto);
      logSuccess(`${plural(numeros.length, 'excepción', 'excepciones')} en ${relativeLabel(cwd, ruta)}`, 'typography');
      return;
    }

    const total = files.reduce((sum, file) => sum + file.incidences.length, 0);

    if (options.json) {
      writeJson({
        ok: total === 0,
        files: files.map((file) => ({ pdf: relativeLabel(cwd, file.pdf), incidences: file.incidences })),
      });
      if (total > 0) process.exitCode = 1;
      return;
    }

    if (total === 0) {
      logSuccess(`sin incidencias en ${plural(targets.length, 'PDF')}`, 'typography');
      return;
    }
    reportIncidencias(cwd, files);
    logInfo('Para guardar una excepción: iteraciones typography --ignore 3,5 (sin números, todas)', 'typography');
    process.exitCode = 1;
    logError(`${plural(total, 'incidencia')} en ${plural(files.length, 'PDF')}`, 'typography');
  } catch (err) {
    fail('typography', err);
  }
}

async function aseguraGit(cwd: string, opcion = '--fix'): Promise<void> {
  let rev: RunResult;
  try {
    rev = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
  } catch {
    throw new BuildError(`typography ${opcion} requiere un repositorio git`);
  }
  if (rev.exitCode !== 0) throw new BuildError(`typography ${opcion} requiere un repositorio git`);
}

async function candidatosDeFuente(cwd: string, pdfPath: string): Promise<string[]> {
  const stem = basename(pdfPath, '.pdf');
  const out = new Set<string>();
  const directo = join(cwd, `${stem}.md`);
  if (await Bun.file(directo).exists()) out.add(directo);

  const recolectaNombres = (valor: unknown, nombres: Set<string>): void => {
    if (Array.isArray(valor)) {
      for (const x of valor) if (typeof x === 'string') nombres.add(x);
    } else if (typeof valor === 'string') {
      nombres.add(valor);
    }
  };
  const agregaCreators = async (nombres: Set<string>): Promise<void> => {
    for (const nombre of nombres) {
      const slug = slugify(nombre);
      const candidato = slug ? join(cwd, `${slug}.md`) : '';
      if (candidato && (await Bun.file(candidato).exists())) out.add(candidato);
    }
  };

  const agregarFiles = async (ruta: string): Promise<void> => {
    const nombres = new Set<string>();
    try {
      const parsed = readFrontmatter(await Bun.file(ruta).text(), ruta);
      for (const campo of ['contributor', 'contributors', 'collectionCreator', 'creator']) {
        recolectaNombres(parsed[campo], nombres);
      }
      const files = Array.isArray(parsed.files) ? parsed.files.filter((x): x is string => typeof x === 'string') : [];
      const base = dirname(ruta);
      for (const f of files) {
        let archivo = '';
        for (const c of [join(base, f), join(cwd, f)]) {
          if (await Bun.file(c).exists()) {
            archivo = c;
            break;
          }
        }
        if (!archivo) continue;
        out.add(archivo);
        const valorArchivo = readFrontmatter(await Bun.file(archivo).text(), archivo);
        recolectaNombres(valorArchivo.creator, nombres);
      }
    } catch {}
    await agregaCreators(nombres);
  };

  if (await Bun.file(directo).exists()) await agregarFiles(directo);

  if (out.size === 0) {
    for (const rel of await listMarkdownDocuments(cwd)) out.add(join(cwd, rel));
  }
  return [...out];
}

const ARCHIVO_HIFENACION = '15-hyphenation-rules.tex';

function escapaRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Agrega la palabra a `preamble/15-hyphenation-rules.tex`, creándolo si el
 * proyecto no lo tiene. Al crearlo se parte del archivo del paquete para no
 * perder las reglas que ya traía.
 */
async function agregaHifenacion(cwd: string, palabra: string): Promise<void> {
  // \hyphenation sólo acepta letras: la puntuación que arrastra la línea del
  // PDF (una coma, un punto) rompe LaTeX con "Not a letter".
  const limpia = palabra.replace(/[^\p{L}]/gu, '');
  if (limpia === '') return;
  const dir = join(cwd, 'preamble');
  const ruta = join(dir, ARCHIVO_HIFENACION);
  let contenido: string;
  if (await Bun.file(ruta).exists()) {
    contenido = await Bun.file(ruta).text();
  } else {
    const base = join(PKG_PREAMBLE_DIR, ARCHIVO_HIFENACION);
    contenido = (await Bun.file(base).exists()) ? await Bun.file(base).text() : '\\hyphenation{\n}\n';
  }
  if (new RegExp(`^\\s*${escapaRegex(limpia)}\\s*$`, 'm').test(contenido)) return;
  const abre = contenido.indexOf('\\hyphenation{');
  const cierra = abre < 0 ? -1 : contenido.indexOf('}', abre);
  let nuevo: string;
  if (abre >= 0 && cierra > abre) {
    const antes = contenido.slice(0, cierra).replace(/\s+$/, '');
    nuevo = `${antes}\n  ${limpia}\n${contenido.slice(cierra)}`;
  } else {
    nuevo = `${contenido.replace(/\s+$/, '')}\n\n\\hyphenation{\n  ${limpia}\n}\n`;
  }
  await mkdir(dir, { recursive: true });
  await Bun.write(ruta, nuevo);
}

function sinComillasTipograficas(texto: string): string {
  return texto.replace(/[“”„‟«»]/g, '"').replace(/[‘’‚]/g, "'");
}

const LIGADURAS_PDF: Record<string, string> = {
  '\u0132': 'IJ',
  '\u0133': 'ij',
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'ft',
  '\uFB06': 'st',
};

const CARACTERES_PDF = /[\u0132\u0133\u2026\uFB00-\uFB06]|\.(?:[ \t]*\.){2,}/gu;

function igualaCaracteresPdf(texto: string): { texto: string; mapa: number[] } {
  if (!new RegExp(CARACTERES_PDF.source, 'u').test(texto)) return { texto, mapa: [] };
  const partes: string[] = [];
  const mapa: number[] = [];
  const empuja = (trocito: string, desde: number, hasta: number): void => {
    for (let k = 0; k < trocito.length; k++) {
      partes.push(trocito[k] as string);
      mapa.push(k === trocito.length - 1 ? hasta - 1 : desde);
    }
  };
  let anterior = 0;
  for (const m of texto.matchAll(CARACTERES_PDF)) {
    const i = m.index as number;
    for (let k = anterior; k < i; k++) {
      partes.push(texto[k] as string);
      mapa.push(k);
    }
    empuja(LIGADURAS_PDF[m[0]] ?? '...', i, i + m[0].length);
    anterior = i + m[0].length;
  }
  for (let k = anterior; k < texto.length; k++) {
    partes.push(texto[k] as string);
    mapa.push(k);
  }
  return { texto: partes.join(''), mapa };
}

function indicesDe(haystack: string, aguja: string): Array<{ inicio: number; fin: number }> {
  const { texto, mapa } = igualaCaracteresPdf(sinComillasTipograficas(haystack));
  const palabras = igualaCaracteresPdf(sinComillasTipograficas(aguja))
    .texto.split(/\s+/u)
    .filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (palabras.length === 0) return [];
  const patron = palabras.join('(?:[\\p{Zs}\\t]*\\r?\\n[\\p{Zs}\\t]*|[\\p{Zs}\\t]+|&nbsp;)');
  const idxs: Array<{ inicio: number; fin: number }> = [];
  const aOriginal = (indice: number): number => (mapa.length === 0 ? indice : (mapa[indice] ?? indice));
  for (const m of texto.matchAll(new RegExp(patron, 'gu'))) {
    if (m.index !== undefined) idxs.push({ inicio: aOriginal(m.index), fin: aOriginal(m.index + m[0].length - 1) + 1 });
  }
  return idxs;
}

function estaEnFrontmatter(content: string, pos: number): boolean {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(content);
  if (!m) return false;
  return pos < m[0].length;
}

function estaEnBloqueYaml(content: string, pos: number): boolean {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(content);
  const yaml = m?.[1];
  if (!m || !yaml) return false;
  const inicio = m.index + m[0].indexOf(yaml);
  if (pos < inicio || pos >= inicio + yaml.length) return false;
  const linea = content.slice(inicio, pos).split('\n').length - 1;
  return lineasDeBloquesYaml(yaml)[linea] ?? false;
}

function posicionProtegida(content: string, pos: number): boolean {
  if (dentroDeQr(content, pos)) return true;
  return estaEnFrontmatter(content, pos) && !estaEnBloqueYaml(content, pos);
}

function lineaPrevia(content: string, pos: number): string {
  return content.slice(content.lastIndexOf('\n', pos - 1) + 1, pos);
}

function lineaSiguiente(content: string, pos: number): string {
  const fin = content.indexOf('\n', pos);
  return content.slice(pos, fin === -1 ? content.length : fin);
}

const LINEA_DE_BLOQUE = /^(?:-{3,}|\.{3,}|:::|#{1,6}\s|[-*+]|\d{1,3}[.)]|>)/;
const LINEA_DE_YAML = /^[\w-]+:/;

function cruzaBloque(lineaIzq: string, ws: string, lineaDer: string): boolean {
  const izq = lineaIzq.trim();
  const der = lineaDer.trim();
  if (!ws.includes('\n')) return /^(?:[-*+]|\d{1,3}[.)])$/.test(izq);
  return LINEA_DE_BLOQUE.test(izq) || /[|>]$/.test(izq) || LINEA_DE_BLOQUE.test(der) || LINEA_DE_YAML.test(der);
}

export type ObjetivoTypography = { aguja: string; posterior: boolean };

export function objetivosParaIncidencia(inc: TypographyIncidence): ObjetivoTypography[] {
  if (inc.type === 'single-word-line') return [{ aguja: inc.text.trim() as string, posterior: false }];
  if (inc.type === 'hyphenated-proper-noun') return [];
  const lineas = inc.lineas;
  const textoDe = (i: number): string => (lineas[i] as { text: string } | undefined)?.text.trim() ?? '';
  const tokens = (texto: string): string[] => texto.split(/\s+/u).filter(Boolean);
  const antes = inc.type === 'repeated-first-letter';
  if (lineas.length < 2) return [{ aguja: textoDe(lineas.length - 1), posterior: !antes }];
  const objetivos: ObjetivoTypography[] = [];
  const agrega = (aguja: string, posterior = !antes): void => {
    objetivos.push({ aguja, posterior });
  };
  const palabrasDe = (i: number): string[] => tokens(textoDe(i));
  const pares = Array.from({ length: lineas.length - 1 }, (_, i) => i);
  if (!antes) pares.reverse();
  for (const i of pares) {
    const palabras = palabrasDe(antes ? i + 1 : i);
    for (let cuantas = palabras.length; cuantas >= 1; cuantas--) {
      agrega((antes ? palabras.slice(0, cuantas) : palabras.slice(-cuantas)).join(' '));
    }
  }
  for (let i = 0; i < lineas.length - 1; i++) {
    const palabrasA = palabrasDe(i);
    const primeraB = palabrasDe(i + 1)[0] ?? '';
    const ultimaA = palabrasA[palabrasA.length - 1] ?? '';
    if (!ultimaA.endsWith('-') || primeraB === '') continue;
    const completa = ultimaA.slice(0, -1) + primeraB;
    for (let desde = 0; desde < palabrasA.length; desde++) {
      objetivos.push({ aguja: [...palabrasA.slice(desde, -1), completa].join(' '), posterior: true });
    }
  }
  const palabrasUltima = palabrasDe(lineas.length - 1);
  for (let cuantas = palabrasUltima.length; cuantas >= 1; cuantas--) {
    agrega(palabrasUltima.slice(-cuantas).join(' '), true);
  }
  const ultimaPalabra = palabrasUltima[palabrasUltima.length - 1] ?? '';
  const primeraSiguiente = tokens(inc.continuacion ?? '')[0] ?? '';
  if (ultimaPalabra.endsWith('-') && primeraSiguiente !== '') {
    const completa = ultimaPalabra.slice(0, -1) + primeraSiguiente;
    for (let desde = 0; desde < palabrasUltima.length; desde++) {
      agrega([...palabrasUltima.slice(desde, -1), completa].join(' '), true);
    }
  }
  const ultima = textoDe(lineas.length - 1);
  if (ultima.length >= 8) agrega(ultima);
  return (objetivos.length > 0 ? objetivos : [{ aguja: ultima, posterior: !antes }]).filter((o) => o.aguja);
}

export function envuelveParrafoContenedor(content: string, inc: TypographyIncidence): string | undefined {
  return (
    envuelveEnFencedDiv(content, inc) ??
    envuelveEnCuerpo(content, inc) ??
    envuelveEnBloquesFrontmatter(content, inc) ??
    envuelveEnTitleFrontmatter(content, inc)
  );
}

const ABRE_FENCE = /^:{3,}\s*\S/;
const CIERRA_FENCE = /^:{3,}\s*$/;

/**
 * Un párrafo que ya vive dentro de un fenced div (`shrink`, `stretch`, etc.) no
 * se puede envolver por fuera: el `runt` se anida para no romper el div que ya
 * estaba.
 */
function envuelveEnFencedDiv(content: string, inc: TypographyIncidence): string | undefined {
  const wordNorm = normalizaParaBusqueda(inc.text.trim());
  const { body } = splitFrontmatter(content);
  const prefijo = content.slice(0, content.length - body.length);
  const lineas = body.split('\n');
  const dentro: boolean[] = [];
  let nivel = 0;
  for (const linea of lineas) {
    if (CIERRA_FENCE.test(linea)) nivel = Math.max(0, nivel - 1);
    dentro.push(nivel > 0);
    if (ABRE_FENCE.test(linea)) nivel += 1;
  }
  const esParrafo = (i: number): boolean => {
    const linea = lineas[i] ?? '';
    return dentro[i] === true && !ABRE_FENCE.test(linea) && !CIERRA_FENCE.test(linea) && linea.trim() !== '';
  };
  const grupos: { ini: number; fin: number }[] = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!esParrafo(i)) continue;
    let ini = i;
    while (ini - 1 >= 0 && esParrafo(ini - 1)) ini--;
    let fin = i;
    while (fin + 1 < lineas.length && esParrafo(fin + 1)) fin++;
    grupos.push({ ini, fin });
    i = fin;
  }
  const textoDe = (g: { ini: number; fin: number }): string => lineas.slice(g.ini, g.fin + 1).join('\n');
  const candidatos = grupos.filter((g) => normalizaParaBusqueda(textoDe(g)).includes(wordNorm));
  if (candidatos.length === 0) return undefined;
  let elegido = candidatos[0] as { ini: number; fin: number };
  const prev = (inc as unknown as { prev?: string }).prev;
  if (candidatos.length > 1 && prev) {
    const prevWords = normalizaParaBusqueda(prev).split(/\s+/).filter(Boolean);
    const marca = (prevWords.length >= 2 ? prevWords.slice(-2) : prevWords).join(' ');
    const conMarca = candidatos.filter((g) => normalizaParaBusqueda(textoDe(g)).includes(marca));
    if (conMarca.length === 1) elegido = conMarca[0] as { ini: number; fin: number };
  }
  // Ya envuelto: el párrafo viene justo después de un div con runt.
  const anterior = (lineas[elegido.ini - 1] ?? '').trim();
  if (ABRE_FENCE.test(anterior) && /\brunt[ \t]*=/.test(anterior)) return undefined;
  // Un div de QR no se toca: su contenido es la imagen.
  for (let j = elegido.ini - 1; j >= 0; j--) {
    const linea = lineas[j] ?? '';
    if (CIERRA_FENCE.test(linea)) break;
    if (ABRE_FENCE.test(linea)) {
      if (/\bqr[ \t]*=/.test(linea)) return undefined;
      break;
    }
  }
  const { ini, fin } = elegido;
  const indent = (lineas[ini] as string).match(/^[ \t]*/)?.[0] ?? '';
  const nuevas = [...lineas.slice(0, ini), `${indent}::: {runt=2}`, ...lineas.slice(ini, fin + 1), `${indent}:::`, ...lineas.slice(fin + 1)];
  return prefijo + nuevas.join('\n');
}

function envuelveEnCuerpo(content: string, inc: TypographyIncidence): string | undefined {
  const word = inc.text.trim();
  const wordNorm = normalizaParaBusqueda(word);
  const prev = (inc as unknown as { prev?: string }).prev;
  const { body } = splitFrontmatter(content);
  const prefijo = content.slice(0, content.length - body.length);
  const bloques = body.split(/\n\s*\n/);
  const matches: number[] = [];
  for (let k = 0; k < bloques.length; k++) {
    const bloqueNorm = normalizaParaBusqueda(bloques[k] ?? '');
    if (bloqueNorm.includes(wordNorm)) matches.push(k);
  }
  let idx = -1;
  if (matches.length === 1) idx = matches[0] as number;
  if (matches.length > 1 && prev) {
    const prevWords = normalizaParaBusqueda(prev).split(/\s+/).filter(Boolean);
    const marca = (prevWords.length >= 2 ? prevWords.slice(-2) : prevWords).join(' ').toLowerCase();
    const seleccionados = matches.filter((k) => {
      const bloqueNorm = normalizaParaBusqueda(bloques[k] ?? '');
      return marca.length > 0 && bloqueNorm.includes(marca);
    });
    if (seleccionados.length === 1) idx = seleccionados[0] as number;
  }
  if (idx < 0) return undefined;
  const bloqueTexto = (bloques[idx] as string).trim();
  const offsetBloque = body.indexOf(bloques[idx] as string);
  if (offsetBloque < 0 || profundidadFenced(body, offsetBloque) > 0) return undefined;
  if (bloqueTexto.startsWith(':::') || /^#{1,6}\s/.test(bloqueTexto)) return undefined;
  bloques[idx] = `::: {runt=2}\n${bloqueTexto}\n:::`;
  return prefijo + bloques.join('\n\n');
}

function lineasDeBloquesYaml(yaml: string): boolean[] {
  const lineas = yaml.split('\n');
  const dentro = lineas.map(() => false);
  let activo = false;
  let indentClave = 0;
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i] as string;
    const texto = linea.trim();
    const indent = linea.length - linea.trimStart().length;
    if (activo) {
      if (texto !== '' && indent <= indentClave) activo = false;
      else {
        dentro[i] = true;
        continue;
      }
    }
    if (/^[^\s#][^:]*:[ \t]*[|>][-+0-9]*[ \t]*$/.test(linea)) {
      activo = true;
      indentClave = indent;
    }
  }
  return dentro;
}

function envuelveEnBloquesFrontmatter(content: string, inc: TypographyIncidence): string | undefined {
  const wordNorm = normalizaParaBusqueda(inc.text.trim());
  const { yaml, body } = splitFrontmatter(content);
  if (!yaml) return undefined;
  const lineas = yaml.split('\n');
  const dentro = lineasDeBloquesYaml(yaml);
  const esFence = (linea: string): boolean => linea.trim().startsWith(':::');
  const noVacia = (i: number): boolean => (lineas[i] as string).trim() !== '';
  const anteriorNoVacia = (i: number): number => {
    let j = i - 1;
    while (j >= 0 && !noVacia(j)) j--;
    return j;
  };
  const siguienteNoVacia = (i: number): number => {
    let j = i + 1;
    while (j < lineas.length && !noVacia(j)) j++;
    return j;
  };
  const yaEnvuelto = (ini: number): boolean => {
    const ant = anteriorNoVacia(ini);
    const sig = siguienteNoVacia(ini);
    return ant >= 0 && sig < lineas.length && (lineas[ant] as string).includes('runt') && (lineas[sig] as string).trim() === ':::';
  };
  const dentroDeQr = (ini: number): boolean => {
    const ant = anteriorNoVacia(ini);
    return ant >= 0 && /^:::.*\bqr[ \t]*=/.test((lineas[ant] as string).trim());
  };
  const matches: { ini: number; fin: number; envuelto: boolean }[] = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!dentro[i] || esFence(lineas[i] as string)) continue;
    if (!normalizaParaBusqueda(lineas[i] as string).includes(wordNorm)) continue;
    let ini = i;
    while (ini - 1 >= 0 && dentro[ini - 1] && noVacia(ini - 1) && !esFence(lineas[ini - 1] as string)) ini--;
    let fin = i;
    while (fin + 1 < lineas.length && dentro[fin + 1] && noVacia(fin + 1) && !esFence(lineas[fin + 1] as string)) fin++;
    if (dentroDeQr(ini)) continue;
    if (matches.some((m) => m.ini === ini)) continue;
    matches.push({ ini, fin, envuelto: yaEnvuelto(ini) });
  }
  if (matches.length === 0) return undefined;
  const prevNorm = normalizaParaBusqueda((inc as { prev?: string }).prev ?? '');
  const nextNorm = normalizaParaBusqueda((inc as { next?: string }).next ?? '');
  const normLinea = (i: number): string => (i >= 0 && i < lineas.length ? normalizaParaBusqueda(lineas[i] as string) : '');
  const conContexto = matches.filter((m) => {
    const ant = normLinea(anteriorNoVacia(m.ini));
    const sig = normLinea(siguienteNoVacia(m.fin));
    return (prevNorm !== '' && ant === prevNorm) || (nextNorm !== '' && sig === nextNorm);
  });
  const elegido = (conContexto.length === 1 ? conContexto[0] : matches[0]) as { ini: number; fin: number; envuelto: boolean };
  if (elegido.envuelto) return undefined;
  const { ini, fin } = elegido;
  const indent = (lineas[ini] as string).match(/^[ \t]*/)?.[0] ?? '';
  const nuevas = [...lineas.slice(0, ini), `${indent}::: {runt=2}`, ...lineas.slice(ini, fin + 1), `${indent}:::`, ...lineas.slice(fin + 1)];
  const nuevoYaml = nuevas.join('\n');
  const fm = content.slice(0, content.length - body.length);
  return fm.replace(yaml, () => nuevoYaml) + body;
}

function envuelveEnTitleFrontmatter(content: string, inc: TypographyIncidence): string | undefined {
  const wordNorm = normalizaParaBusqueda(inc.text.trim());
  const { yaml, body } = splitFrontmatter(content);
  if (!yaml) return undefined;
  if (yaml.split('\n').some((linea) => normalizaParaBusqueda(linea) === wordNorm)) return undefined;
  const m = /^title:[ \t]*(.+)$/m.exec(yaml);
  if (!m) return undefined;
  let valor = (m[1] as string).trim();
  if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
    valor = valor.slice(1, -1);
  }
  if (valor.includes(':::') || normalizaParaBusqueda(valor) !== wordNorm) return undefined;
  const nuevoYaml = yaml.replace(m[0], () => `title: |\n  ::: {runt=2}\n  ${valor}\n  :::`);
  const fm = content.slice(0, content.length - body.length);
  return fm.replace(yaml, () => nuevoYaml) + body;
}

function sinMarcaDeTitulo(texto: string): string {
  return texto.replace(/^\s*#{1,6}\s+/, '');
}

export function tienePalabraSuelta(contenido: string, wordNorm: string): boolean {
  const { yaml, body } = splitFrontmatter(contenido);
  if (yaml) {
    for (const linea of yaml.split('\n')) {
      if (normalizaParaBusqueda(linea) === wordNorm) return true;
      const m = /^\s*[^:]+:[ \t]*(.+)$/.exec(linea);
      if (m && normalizaParaBusqueda(m[1] as string) === wordNorm) return true;
    }
  }
  for (const bloque of body.split(/\n\s*\n/)) {
    if (normalizaParaBusqueda(sinMarcaDeTitulo(bloque)) === wordNorm) return true;
  }
  return false;
}

export function esTituloDeSeccion(content: string, inc: TypographyIncidence): boolean {
  if (inc.type !== 'single-word-line') return false;
  const wordNorm = normalizaParaBusqueda(inc.text.trim());
  if (/[.,;:!?…]$/.test(wordNorm)) return false;
  const { body } = splitFrontmatter(content);
  for (const bloque of body.split(/\n\s*\n/)) {
    const primera = bloque.trimStart().split('\n')[0] ?? '';
    const m = /^#{1,6}[ \t]+(.+)$/.exec(primera);
    if (m && normalizaParaBusqueda(m[1] as string) === wordNorm) return true;
  }
  return false;
}

function profundidadFenced(content: string, pos: number): number {
  let dentro = false;
  for (const linea of content.slice(0, Math.max(0, pos)).split('\n')) {
    if (/^:{3,}/.test(linea)) dentro = !dentro;
  }
  return dentro ? 1 : 0;
}

function dentroDeQr(content: string, pos: number): boolean {
  let dentro = false;
  let esQr = false;
  for (const linea of content.slice(0, Math.max(0, pos)).split('\n')) {
    if (!/^:{3,}/.test(linea)) continue;
    dentro = !dentro;
    esQr = dentro && /\bqr[ \t]*=/.test(linea);
  }
  return dentro && esQr;
}

export function remplazaEspacioPosterior(content: string, needle: string): string | undefined {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return undefined;
  const { inicio, fin } = idxs[0] as { inicio: number; fin: number };
  if (posicionProtegida(content, inicio)) return undefined;
  let j = fin;
  while (j < content.length && /\s/.test(content[j] ?? '')) j++;
  const ws = content.slice(fin, j);
  if (ws === '' || /\n[ \t]*\n/.test(ws)) return undefined;
  if (cruzaBloque(lineaPrevia(content, fin), ws, lineaSiguiente(content, j))) return undefined;
  return `${content.slice(0, fin)}&nbsp;${content.slice(j)}`;
}

export function remplazaEspacioAnterior(content: string, needle: string): string | undefined {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return undefined;
  const { inicio } = idxs[0] as { inicio: number; fin: number };
  if (posicionProtegida(content, inicio)) return undefined;
  if (inicio === 0) return undefined;
  let j = inicio - 1;
  while (j >= 0 && /\s/.test(content[j] ?? '')) j--;
  const inicioWs = j + 1;
  if (inicioWs >= inicio || /\n[ \t]*\n/.test(content.slice(inicioWs, inicio))) return undefined;
  if (cruzaBloque(lineaPrevia(content, inicioWs), content.slice(inicioWs, inicio), lineaSiguiente(content, inicio))) return undefined;
  return `${content.slice(0, inicioWs)}&nbsp;${content.slice(inicio)}`;
}

export function yaAplicado(content: string, needle: string, posterior: boolean): boolean {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return false;
  const { inicio, fin } = idxs[0] as { inicio: number; fin: number };
  const pegote = posterior ? content.slice(fin, fin + 6) : content.slice(Math.max(0, inicio - 6), inicio);
  const crudo = posterior ? content[fin] : content[inicio - 1];
  return pegote === '&nbsp;' || crudo === '\u00a0';
}

function agujaEncontrada(content: string, aguja: string): boolean {
  return indicesDe(content, aguja).length === 1;
}

export function normalizaParaBusqueda(texto: string): string {
  return igualaCaracteresPdf(sinComillasTipograficas(texto))
    .texto.replace(/&nbsp;|&#160;|&#xa0;|\u00a0/gi, ' ')
    .replace(/:::[^\n]*/g, ' ')
    .replace(/[*_`]+/g, '')
    .replace(/\[([^\]]*)\]\{[^}]*\}/g, '$1')
    .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.match(/^\[([^\]]*)\]/)?.[1] ?? '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function ngramasBusqueda(texto: string): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const fiesta = new Set<string>();
  for (let tam = 6; tam >= 3; tam--) {
    for (let i = 0; i + tam <= palabras.length; i++) {
      const frase = palabras.slice(i, i + tam).join(' ');
      if (frase.length >= 12) fiesta.add(frase);
    }
  }
  if (palabras.length >= 3) {
    fiesta.add(palabras.slice(Math.max(0, palabras.length - 4), palabras.length).join(' '));
    fiesta.add(palabras.slice(0, Math.min(palabras.length, 4)).join(' '));
  }
  return [...fiesta];
}

function cadenasDeBusqueda(inc: TypographyIncidence): string[] {
  if (inc.type === 'hyphenated-proper-noun') return [];
  if (inc.type === 'single-word-line') {
    const fiesta = new Set<string>();
    const palabra = normalizaParaBusqueda(inc.text);
    if (palabra.length >= 4) fiesta.add(palabra);
    if (inc.prev) {
      const prev = normalizaParaBusqueda(inc.prev);
      if (prev.length >= 6) fiesta.add(`${prev} ${palabra}`.trim());
      const prevPalabras = prev.split(/\s+/).filter(Boolean);
      if (prevPalabras.length >= 1) fiesta.add(`${prevPalabras.slice(-1)[0]} ${palabra}`.trim());
      if (prevPalabras.length >= 3) fiesta.add(`${prevPalabras.slice(-3).join(' ')} ${palabra}`.trim());
    }
    if (fiesta.size === 0) fiesta.add(palabra);
    return [...fiesta].sort((a, b) => b.length - a.length);
  }
  const lineas = inc.lineas.map((l) => normalizaParaBusqueda(l.text));
  const unidas = lineas.join(' ');
  const fiesta = new Set<string>();
  const objetivo = normalizaParaBusqueda(inc.lineas[inc.lineas.length - 1]?.text ?? '');
  if (objetivo.length >= 6) fiesta.add(objetivo);
  if (inc.type === 'repeated-first-letter') {
    const primero = normalizaParaBusqueda(inc.lineas[0]?.text ?? '');
    if (primero.length >= 6) fiesta.add(primero);
  }
  for (const n of ngramasBusqueda(unidas)) fiesta.add(n);
  return [...fiesta].sort((a, b) => b.length - a.length);
}

function resuelveCandidatoFuentes(rutas: string[], contenidoNormalizado: Map<string, string>, frases: string[]): string[] {
  let candidatos = [...rutas];
  for (const frase of frases) {
    if (candidatos.length === 0 || frase.length < 6) continue;
    const siguientes = candidatos.filter((r) => contenidoNormalizado.get(r)?.includes(frase) ?? false);
    if (siguientes.length === 1) return siguientes;
    if (siguientes.length > 0 && siguientes.length < candidatos.length) candidatos = siguientes;
  }
  return candidatos;
}

type MotivoIncidencia =
  | 'corregido'
  | 'no aplica'
  | 'múltiples coincidencias'
  | 'no encontrado'
  | 'sin acción'
  | 'sin unión pegable'
  | 'sin coincidencia exacta';

const DIV_DE_AJUSTE = /\b(?:runt|shrink|stretch)\b/;

function abreDivDeAjuste(linea: string): boolean {
  return /^[ \t]*:::+[ \t]*\{[^}]*\}/.test(linea) && DIV_DE_AJUSTE.test(linea);
}

function cierraDiv(linea: string): boolean {
  return /^[ \t]*:::+[ \t]*$/.test(linea);
}

/** Los bloques de texto separados por líneas en blanco. */
function bloquesDeTexto(content: string): { inicio: number; fin: number }[] {
  const bloques: { inicio: number; fin: number }[] = [];
  let inicio = 0;
  for (const encontrado of content.matchAll(/\n[ \t]*\n/g)) {
    if (encontrado.index > inicio) bloques.push({ inicio, fin: encontrado.index });
    inicio = encontrado.index + encontrado[0].length;
  }
  if (inicio < content.length) bloques.push({ inicio, fin: content.length });
  return bloques;
}

/** Extiende el rango del párrafo a los fenced divs de ajuste que lo envuelven. */
function extiendeAFences(content: string, inicio: number, fin: number): { inicio: number; fin: number } {
  const lineas = content.split('\n');
  const offsets: number[] = [];
  let acumulado = 0;
  for (const linea of lineas) {
    offsets.push(acumulado);
    acumulado += linea.length + 1;
  }
  const lineaDe = (posicion: number): number => {
    let i = 0;
    while (i + 1 < offsets.length && (offsets[i + 1] as number) <= posicion) i++;
    return i;
  };
  let desde = lineaDe(inicio);
  let hasta = lineaDe(Math.max(inicio, fin - 1));
  for (;;) {
    let j = desde - 1;
    while (j >= 0 && (lineas[j] as string).trim() === '') j--;
    if (j < 0 || !abreDivDeAjuste(lineas[j] as string)) break;
    desde = j;
  }
  for (;;) {
    let j = hasta + 1;
    while (j < lineas.length && (lineas[j] as string).trim() === '') j++;
    if (j >= lineas.length || !cierraDiv(lineas[j] as string)) break;
    hasta = j;
  }
  return {
    inicio: offsets[desde] ?? inicio,
    fin: (offsets[hasta] ?? fin) + (lineas[hasta] as string).length,
  };
}

/** El párrafo del hallazgo, con sus divs de ajuste, si se puede identificar. */
function parrafoDeIncidencia(content: string, incidencia: TypographyIncidence): { inicio: number; fin: number } | undefined {
  const frases = cadenasDeBusqueda(incidencia).filter((frase) => frase.length >= 6);
  const puntajes = bloquesDeTexto(content).map((bloque) => {
    const normalizado = normalizaParaBusqueda(content.slice(bloque.inicio, bloque.fin));
    return { ...bloque, puntos: frases.filter((frase) => normalizado.includes(frase)).length };
  });
  const maximo = Math.max(...puntajes.map((p) => p.puntos), 0);
  if (maximo === 0) return undefined;
  const mejores = puntajes.filter((p) => p.puntos === maximo);
  if (mejores.length !== 1) return undefined;
  const elegido = mejores[0] as { inicio: number; fin: number };
  return extiendeAFences(content, elegido.inicio, elegido.fin);
}

/** Deja el párrafo sin &nbsp;, sin .text-nowrap y sin runt/shrink/stretch. */
export function limpiaParrafo(texto: string): string {
  let limpio = texto.replace(/&nbsp;|&#160;|&#xa0;|\u00a0/gi, ' ');
  limpio = limpio.replace(/\[([^\]]+)\]\{([^}]*\.text-(?:nowrap|no-wrap)[^}]*)\}/g, '$1');
  const salida: string[] = [];
  const pila: boolean[] = [];
  for (const linea of limpio.split('\n')) {
    const abre = /^[ \t]*:::+[ \t]*\{([^}]*)\}[ \t]*$/.exec(linea);
    if (abre) {
      const quitar = DIV_DE_AJUSTE.test(abre[1] ?? '');
      pila.push(quitar);
      if (!quitar) salida.push(linea);
      continue;
    }
    if (cierraDiv(linea)) {
      if (pila.pop() !== true) salida.push(linea);
      continue;
    }
    salida.push(linea);
  }
  return salida.join('\n');
}

async function limpiaTypografia(
  cwd: string,
  targets: string[],
  analisis: OpcionesAnalisis,
  options: TypographyOptions,
): Promise<{
  limpiados: number;
  sinLimpiar: number;
  porPdf: Map<string, { incidences: TypographyIncidence[]; estado: Map<TypographyIncidence, string> }>;
}> {
  await aseguraGit(cwd, '--clean');
  const excepciones = cargarExcepciones(cwd, options, true);
  const analizados = await mapWithConcurrency(targets, 4, async (pdf) => ({
    pdf,
    incidences: await analyzePdf(pdf, { ...analisis, excepciones, archivo: relativeLabel(cwd, pdf) }),
  }));
  const planas = analizados.flatMap((file) => file.incidences.map((incidencia) => ({ pdf: file.pdf, incidencia })));
  const numeros =
    typeof options.clean === 'string' ? seleccionaIncidencias(options.clean, planas.length, '--clean') : planas.map((_, indice) => indice + 1);
  const porPdf = new Map<string, { incidences: TypographyIncidence[]; estado: Map<TypographyIncidence, string> }>();
  for (const numero of numeros) {
    const elegida = planas[numero - 1] as { pdf: string; incidencia: TypographyIncidence };
    const actual = porPdf.get(elegida.pdf) ?? { incidences: [], estado: new Map<TypographyIncidence, string>() };
    actual.incidences.push(elegida.incidencia);
    porPdf.set(elegida.pdf, actual);
  }

  let limpiados = 0;
  let sinLimpiar = 0;
  for (const [pdf, resultado] of porPdf) {
    const fuentes = await candidatosDeFuente(cwd, pdf);
    const contenido = new Map<string, string>();
    const contenidoNormalizado = new Map<string, string>();
    for (const fuente of fuentes) {
      try {
        const texto = await Bun.file(fuente).text();
        contenido.set(fuente, texto);
        contenidoNormalizado.set(fuente, normalizaParaBusqueda(texto));
      } catch {}
    }
    for (const incidencia of resultado.incidences) {
      const candidatos = resuelveCandidatoFuentes([...contenido.keys()], contenidoNormalizado, cadenasDeBusqueda(incidencia));
      if (candidatos.length !== 1) {
        resultado.estado.set(incidencia, candidatos.length === 0 ? 'no encontrado' : 'múltiples coincidencias');
        sinLimpiar++;
        continue;
      }
      const ruta = candidatos[0] as string;
      const texto = contenido.get(ruta) ?? '';
      const parrafo = parrafoDeIncidencia(texto, incidencia);
      if (parrafo === undefined) {
        resultado.estado.set(incidencia, 'no encontrado');
        sinLimpiar++;
        continue;
      }
      const original = texto.slice(parrafo.inicio, parrafo.fin);
      const limpio = limpiaParrafo(original);
      if (limpio === original) {
        resultado.estado.set(incidencia, 'sin cambios');
        continue;
      }
      contenido.set(ruta, texto.slice(0, parrafo.inicio) + limpio + texto.slice(parrafo.fin));
      contenidoNormalizado.set(ruta, normalizaParaBusqueda(contenido.get(ruta) ?? ''));
      resultado.estado.set(incidencia, 'limpio');
      limpiados++;
    }
    for (const [ruta, texto] of contenido) {
      if (texto !== (await Bun.file(ruta).text())) await Bun.write(ruta, texto);
    }
  }
  return { limpiados, sinLimpiar, porPdf };
}

async function arreglaTypografia(
  cwd: string,
  targets: string[],
  analisis: OpcionesAnalisis,
  options: TypographyOptions = {},
): Promise<{
  corregidos: number;
  sinAplicar: number;
  noEncontradas: number;
  multiples: number;
  noAplica: number;
  sinAccion: number;
  sinUnion: number;
  exactMiss: number;
  porPdf: Map<string, { incidences: TypographyIncidence[]; estado: Map<TypographyIncidence, MotivoIncidencia> }>;
}> {
  await aseguraGit(cwd);

  let corregidos = 0;
  let sinAplicar = 0;
  let noEncontradas = 0;
  let multiples = 0;
  let noAplica = 0;
  let sinAccion = 0;
  let sinUnion = 0;
  let exactMiss = 0;
  const porPdf = new Map<string, { incidences: TypographyIncidence[]; estado: Map<TypographyIncidence, MotivoIncidencia> }>();

  const excepciones = cargarExcepciones(cwd, options);
  for (const pdf of targets) {
    const incidences = await analyzePdf(pdf, { ...analisis, excepciones, archivo: relativeLabel(cwd, pdf) });
    if (incidences.length === 0) continue;
    porPdf.set(pdf, { incidences, estado: new Map<TypographyIncidence, MotivoIncidencia>() });
  }

  // Con números, `--fix` elige por el número que trae el informe, igual que `--ignore`.
  if (typeof options.fix === 'string') {
    const planas = [...porPdf.values()].flatMap((resultado) => resultado.incidences);
    const numeros = seleccionaIncidencias(options.fix, planas.length, '--fix');
    const elegidas = new Set(numeros.map((numero) => planas[numero - 1]));
    for (const [pdf, resultado] of porPdf) {
      const filtradas = resultado.incidences.filter((incidencia) => elegidas.has(incidencia));
      if (filtradas.length === 0) porPdf.delete(pdf);
      else resultado.incidences = filtradas;
    }
  }

  for (const [pdf, { incidences, estado }] of porPdf) {
    // Los nombres cortados no se corrigen en el Markdown: van al preamble.
    const cortadas = incidences.filter((inc) => inc.type === 'hyphenated-proper-noun');
    for (const inc of cortadas) {
      await agregaHifenacion(cwd, palabraSinCorte(inc));
      estado.set(inc, 'corregido');
      corregidos++;
    }
    const resto = incidences.filter((inc) => inc.type !== 'hyphenated-proper-noun');
    if (resto.length === 0) continue;

    const fuentes = await candidatosDeFuente(cwd, pdf);
    if (fuentes.length === 0) {
      for (const inc of resto) estado.set(inc, 'no encontrado');
      sinAplicar += resto.length;
      noEncontradas += resto.length;
      continue;
    }

    const contenido = new Map<string, string>();
    const contenidoNormalizado = new Map<string, string>();
    for (const f of fuentes) {
      try {
        const txt = await Bun.file(f).text();
        contenido.set(f, txt);
        contenidoNormalizado.set(f, normalizaParaBusqueda(txt));
      } catch {}
    }

    for (const inc of resto) {
      const objetivos = objetivosParaIncidencia(inc);
      const objetivo = objetivos[0] ?? '';
      if (!objetivo) {
        estado.set(inc, 'no encontrado');
        sinAplicar++;
        noEncontradas++;
        continue;
      }
      const frases = cadenasDeBusqueda(inc);
      let candidatos = resuelveCandidatoFuentes([...contenido.keys()], contenidoNormalizado, frases);
      if (candidatos.length > 1 && inc.type === 'single-word-line') {
        const palabra = normalizaParaBusqueda(inc.text);
        const sueltos = candidatos.filter((r) => tienePalabraSuelta(contenido.get(r) ?? '', palabra));
        if (sueltos.length === 1) candidatos = sueltos;
      }

      if (candidatos.length !== 1) {
        const aguja = normalizaParaBusqueda(inc.text);
        const algunaFuente =
          inc.type === 'single-word-line' && aguja !== '' && candidatos.some((r) => (contenidoNormalizado.get(r) ?? '').includes(aguja));
        estado.set(inc, candidatos.length === 0 || !algunaFuente ? 'no encontrado' : 'múltiples coincidencias');
        sinAplicar++;
        if (candidatos.length === 0 || !algunaFuente) noEncontradas++;
        else multiples++;

        continue;
      }

      const ruta = candidatos[0] as string;
      const actual = contenido.get(ruta);
      if (actual === undefined) {
        estado.set(inc, 'sin coincidencia exacta');
        sinAplicar++;
        exactMiss++;
        continue;
      }

      let nuevo: string | undefined;
      let yaPegado = false;
      let unionRechazada = false;
      if (inc.type === 'single-word-line') {
        nuevo = envuelveParrafoContenedor(actual, inc);
      } else {
        nuevo = undefined;
        for (const objetivo of objetivos) {
          if (yaAplicado(actual, objetivo.aguja, objetivo.posterior)) {
            yaPegado = true;
            continue;
          }
          nuevo = objetivo.posterior ? remplazaEspacioPosterior(actual, objetivo.aguja) : remplazaEspacioAnterior(actual, objetivo.aguja);
          if (nuevo !== undefined && nuevo !== actual) break;
          if (nuevo === undefined && agujaEncontrada(actual, objetivo.aguja)) unionRechazada = true;
        }
      }

      if (nuevo === undefined || nuevo === actual) {
        if (esTituloDeSeccion(actual, inc)) {
          estado.set(inc, 'no aplica');
          sinAplicar++;
          noAplica++;
          continue;
        }
        if (yaPegado) {
          estado.set(inc, 'sin acción');
          sinAplicar++;
          sinAccion++;
          continue;
        }
        if (unionRechazada) {
          estado.set(inc, 'sin unión pegable');
          sinAplicar++;
          sinUnion++;
          continue;
        }
        estado.set(inc, 'sin coincidencia exacta');
        sinAplicar++;
        exactMiss++;
        continue;
      }

      contenido.set(ruta, nuevo);
      corregidos++;
      estado.set(inc, 'corregido');
    }

    for (const [ruta, texto] of contenido) {
      if (texto !== (await Bun.file(ruta).text())) {
        await Bun.write(ruta, texto);
      }
    }
  }

  return { corregidos, sinAplicar, noEncontradas, multiples, noAplica, sinAccion, sinUnion, exactMiss, porPdf };
}
