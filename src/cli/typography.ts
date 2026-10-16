import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fail, logError, logInfo, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import {
  analyzePdf,
  filtraExcepciones,
  type OpcionesAnalisis,
  parseaExcepciones,
  TODAS_LAS_REGLAS,
  type TypographyIncidence,
} from '../lib/pdf-typography.js';
import { plural } from '../lib/plural.js';
import { exec, mapWithConcurrency, type RunResult } from '../lib/run.js';
import { listPdfFiles } from '../lib/visual-diff.js';

export interface TypographyOptions {
  output?: string;
  json?: boolean;
  pages?: string;
  minLineWidth?: string;
  rules?: string;
  minLines?: string;
  minLetters?: string;
  exceptions?: string;
  fix?: boolean;
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

/**
 * Interpreta --rules: una o varias separadas por coma. Sin la opción entran todas, que es lo que
 * se quiere por defecto; con ella el informe sale corto a propósito.
 */
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

function cargarExcepciones(cwd: string, options: TypographyOptions): ReturnType<typeof parseaExcepciones> {
  const ruta = resolvePath(cwd, options.exceptions ?? '.typography-exceptions');
  let contenido: string | undefined;
  try {
    contenido = readFileSync(ruta, 'utf8');
  } catch (err) {
    const codigo = (err as NodeJS.ErrnoException).code;
    if (codigo !== 'ENOENT') throw err;
    if (options.exceptions !== undefined) {
      throw new BuildError(`no existe el archivo de excepciones ${etiqueta(cwd, ruta)}`);
    }
  }
  return contenido === undefined ? [] : parseaExcepciones(contenido);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flujo de informe y --fix
export async function runTypography(cwd: string, args: string[], options: TypographyOptions = {}): Promise<void> {
  try {
    const analisis = opcionesDeAnalisis(options);
    const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
    const targets = args.length > 0 ? args.map((path) => resolvePath(cwd, path)) : await listPdfFiles(outputDir);
    if (targets.length === 0) throw new BuildError(`no hay PDFs en ${etiqueta(cwd, outputDir)}`);

    if (options.fix) {
      const { corregidos, sinAplicar, noEncontradas, multiples, noAplica, exactMiss, porPdf } = await arreglaTypografia(
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
      const lineas: string[] = [];
      for (const pdf of targets) {
        const resultado = porPdf.get(pdf);
        if (!resultado || resultado.incidences.length === 0) continue;
        lineas.push(`${etiqueta(cwd, pdf)} · ${plural(resultado.incidences.length, 'incidencia')}`);
        lineas.push(
          ...resultado.incidences.map((incidencia) => {
            const partes = formatea(incidencia).split('\n');
            const motivo = resultado.estado.get(incidencia);
            if (motivo) partes[0] = `${partes[0]}  ${motivo}`;
            return partes.join('\n');
          }),
        );
      }
      logInfo(lineas.join('\n'), 'typography');
      const partes = [`${corregidos} corregidas de ${total}`];
      const sinCorregir = sinAplicar;
      if (sinCorregir > 0) {
        partes.push(`${sinCorregir} sin corregir`);
        const detalle = [
          noEncontradas > 0 ? `${noEncontradas} no encontradas` : '',
          multiples > 0 ? `${multiples} con múltiples coincidencias` : '',
          noAplica > 0 ? `${noAplica} no aplica (títulos de sección)` : '',
          exactMiss > 0 ? `${exactMiss} sin coincidencia exacta` : '',
        ].filter(Boolean);
        if (detalle.length > 0) partes.push(`(${detalle.join(', ')})`);
      }
      logInfo(partes.join(' · '), 'typography');
      if (sinAplicar > 0) process.exitCode = 1;
      return;
    }

    const excepciones = cargarExcepciones(cwd, options);

    const files = await mapWithConcurrency(targets, 4, async (pdf) => ({
      pdf,
      incidences: filtraExcepciones(await analyzePdf(pdf, analisis), etiqueta(cwd, pdf), excepciones),
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

async function aseguraGitLimpio(cwd: string): Promise<void> {
  let rev: RunResult;
  try {
    rev = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
  } catch {
    throw new BuildError('typography --fix requiere un repositorio git');
  }
  if (rev.exitCode !== 0) throw new BuildError('typography --fix requiere un repositorio git');
  const st = await exec('git', ['status', '--porcelain'], { cwd });
  if (st.exitCode !== 0 || st.stdout.trim() !== '') {
    throw new BuildError('typography --fix es destructivo: requiere un árbol git limpio (sin cambios)');
  }
}

async function candidatosDeFuente(cwd: string, pdfPath: string): Promise<string[]> {
  const stem = basename(pdfPath, '.pdf');
  const out = new Set<string>();
  const directo = join(cwd, `${stem}.md`);
  if (await Bun.file(directo).exists()) out.add(directo);

  const slugDe = (nombre: string): string =>
    nombre
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
  const recolectaNombres = (valor: unknown, nombres: Set<string>): void => {
    if (Array.isArray(valor)) {
      for (const x of valor) if (typeof x === 'string') nombres.add(x);
    } else if (typeof valor === 'string') {
      nombres.add(valor);
    }
  };
  const agregaCreators = async (nombres: Set<string>): Promise<void> => {
    for (const nombre of nombres) {
      const slug = slugDe(nombre);
      const candidato = slug ? join(cwd, `${slug}.md`) : '';
      if (candidato && (await Bun.file(candidato).exists())) out.add(candidato);
    }
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lectura de collection frontmatter
  const agregarFiles = async (ruta: string): Promise<void> => {
    const nombres = new Set<string>();
    try {
      const { yaml } = splitFrontmatter(await Bun.file(ruta).text());
      if (!yaml) return;
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown> | null;
      if (!parsed) return;
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
        const { yaml: yamlArchivo } = splitFrontmatter(await Bun.file(archivo).text());
        const parsedArchivo = yamlArchivo ? (Bun.YAML.parse(yamlArchivo) as Record<string, unknown> | null) : null;
        recolectaNombres(parsedArchivo?.creator, nombres);
      }
    } catch {
      // mejor saltarse un frontmatter roto que abortar
    }
    await agregaCreators(nombres);
  };

  if (await Bun.file(directo).exists()) await agregarFiles(directo);

  if (out.size === 0) {
    const glob = new Bun.Glob('**/*.md');
    for await (const rel of glob.scan({ cwd, onlyFiles: true })) {
      const parts = rel.split('/');
      if (parts.some((p) => p === 'node_modules' || p === '.iteraciones' || p === 'dist' || p.startsWith('.'))) continue;
      const abs = join(cwd, rel);
      if (await Bun.file(abs).exists()) out.add(abs);
    }
  }
  return [...out];
}

/** El PDF dibuja «“ ” ‘ ’» donde el markdown trae «"» o «'»; igualarlas conserva las posiciones. */
function sinComillasTipograficas(texto: string): string {
  return texto.replace(/[“”„‟«»]/g, '"').replace(/[‘’‚]/g, "'");
}

/** Posiciones de una frase: entre palabras acepta un corte de línea del markdown o un espacio ya pegado, nunca una línea en blanco. */
function indicesDe(haystack: string, aguja: string): Array<{ inicio: number; fin: number }> {
  const texto = sinComillasTipograficas(haystack);
  const palabras = sinComillasTipograficas(aguja)
    .split(/\s+/u)
    .filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (palabras.length === 0) return [];
  const patron = palabras.join('(?:[\\p{Zs}\\t]*\\r?\\n[\\p{Zs}\\t]*|[\\p{Zs}\\t]+|&nbsp;)');
  const idxs: Array<{ inicio: number; fin: number }> = [];
  for (const m of texto.matchAll(new RegExp(patron, 'gu'))) {
    if (m.index !== undefined) idxs.push({ inicio: m.index, fin: m.index + m[0].length });
  }
  return idxs;
}

function estaEnFrontmatter(content: string, pos: number): boolean {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(content);
  if (!m) return false;
  return pos < m[0].length;
}

/** ¿La posición cae dentro de un escalar de bloque del frontmatter (`clave: |`)? Su contenido es markdown. */
function estaEnBloqueYaml(content: string, pos: number): boolean {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(content);
  const yaml = m?.[1];
  if (!m || !yaml) return false;
  const inicio = m.index + m[0].indexOf(yaml);
  if (pos < inicio || pos >= inicio + yaml.length) return false;
  const linea = content.slice(inicio, pos).split('\n').length - 1;
  return lineasDeBloquesYaml(yaml)[linea] ?? false;
}

/** ¿La posición no debe editarse? Fuera de un bloque `qr` y del YAML que no es un escalar de bloque. */
function posicionProtegida(content: string, pos: number): boolean {
  if (dentroDeQr(content, pos)) return true;
  return estaEnFrontmatter(content, pos) && !estaEnBloqueYaml(content, pos);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: algoritmo de hidridacion
export function objetivosParaIncidencia(inc: TypographyIncidence): string[] {
  if (inc.type === 'single-word-line') return [inc.text.trim() as string];
  const lineas = inc.lineas;
  const textoDe = (i: number): string => (lineas[i] as { text: string } | undefined)?.text.trim() ?? '';
  const tokens = (texto: string): string[] => texto.split(/\s+/u).filter(Boolean);
  if (lineas.length < 2) return [textoDe(lineas.length - 1)];
  const objetivos: string[] = [];
  // El &nbsp; se pega justo en la unión de dos líneas: la aguja termina en la última palabra de
  // la primera línea, para que el espacio que sigue sea el del corte. La unión más cercana al
  // final de la corrida va primero: es la que rompe la repetición sin mover el resto.
  for (let i = lineas.length - 2; i >= 0; i--) {
    const finIzq = tokens(textoDe(i));
    if (finIzq.length === 0) continue;
    // Todas las longitudes terminan en la última palabra de la línea, así que el espacio que se
    // pega es el mismo (el del corte); la más larga es la que mejor desambigua: «ya no» aparece
    // seis veces y se descarta, «mal contada que ya no» no.
    for (let cuantas = finIzq.length; cuantas >= 1; cuantas--) {
      objetivos.push(finIzq.slice(finIzq.length - cuantas).join(' '));
    }
  }
  const objetivoRegex = /(\S+[.,;:!?…»’”])\s+(\S+)/gu;
  for (const linea of lineas) {
    for (const m of [...(linea.text || '').matchAll(objetivoRegex)]) {
      const anterior = m[1];
      const siguiente = m[2];
      if (anterior && siguiente) objetivos.push(`${anterior} ${siguiente}`);
    }
  }
  for (let i = 0; i < lineas.length - 1; i++) {
    const a = (lineas[i] as { text: string }).text.trimEnd();
    const antRaw = (a.match(/(\S+)$/) || ['', a.trim()])[1] as string;
    const sigRaw = ((lineas[i + 1] as { text: string }).text.trim().match(/^\S+/) || [''])[0] as string;
    const nextTokens = (lineas[i + 1] as { text: string }).text.trim().split(/\s+/u).filter(Boolean);
    let token = antRaw;
    let siguiente = sigRaw;
    if (antRaw.endsWith('-') && sigRaw.length > 0 && nextTokens.length > 0) {
      token = antRaw.slice(0, -1) + nextTokens[0];
      siguiente = nextTokens.length > 1 ? (nextTokens[1] as string) : (nextTokens[0] as string);
    }
    if (token.length >= 3 && siguiente.length >= 1) objetivos.push(`${token} ${siguiente}`);
  }
  const ultima = textoDe(lineas.length - 1);
  if (ultima.length >= 8) objetivos.push(ultima);
  return (objetivos.length > 0 ? objetivos : [ultima]).filter(Boolean);
}

export function envuelveParrafoContenedor(content: string, inc: TypographyIncidence): string | undefined {
  return envuelveEnCuerpo(content, inc) ?? envuelveEnBloquesFrontmatter(content, inc) ?? envuelveEnTitleFrontmatter(content, inc);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: desambigua el párrafo contenedor en el cuerpo
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

/** Marca las líneas del frontmatter que pertenecen a un escalar de bloque (`clave: |`). */
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: párrafos dentro de titleback, colophon, etc.
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
  // si ya hay una ocurrencia suelta en un bloque del frontmatter, el título no es el objetivo
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

/** Quita la marca de encabezado (`#`, `##`, …) para comparar el título como palabra suelta. */
function sinMarcaDeTitulo(texto: string): string {
  return texto.replace(/^\s*#{1,6}\s+/, '');
}

/** ¿La palabra aparece como unidad suelta (valor, encabezado o párrafo completo) en el archivo? */
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

/**
 * ¿La incidencia corresponde a un encabezado (`# Título`) del markdown? Los títulos de sección no
 * se envuelven con `runt`, así que la corrección no aplica.
 */
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

/** ¿La posición cae dentro de un bloque `::: {qr=…}`? Su contenido (una URL) no debe tocarse. */
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

/** Une con `&nbsp;` el espacio posterior a `needle`. Sí aplica dentro de un `::: {runt=2}`. */
export function remplazaEspacioPosterior(content: string, needle: string): string | undefined {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return undefined;
  const { inicio, fin } = idxs[0] as { inicio: number; fin: number };
  if (posicionProtegida(content, inicio)) return undefined;
  let j = fin;
  while (j < content.length && /\s/.test(content[j] ?? '')) j++;
  const ws = content.slice(fin, j);
  // ya está unido, o el espacio cruza un corte de párrafo/bloque y no debe tocarse
  if (ws === '' || /\n[ \t]*\n/.test(ws)) return undefined;
  return `${content.slice(0, fin)}&nbsp;${content.slice(j)}`;
}

/** Une con `&nbsp;` el espacio anterior a `needle`. Sí aplica dentro de un `::: {runt=2}`. */
export function remplazaEspacioAnterior(content: string, needle: string): string | undefined {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return undefined;
  const { inicio } = idxs[0] as { inicio: number; fin: number };
  if (posicionProtegida(content, inicio)) return undefined;
  if (inicio === 0) return undefined;
  let j = inicio - 1;
  while (j >= 0 && /\s/.test(content[j] ?? '')) j--;
  const inicioWs = j + 1;
  // no hay espacio que cambiar, o el espacio cruza un corte de párrafo/bloque
  if (inicioWs >= inicio || /\n[ \t]*\n/.test(content.slice(inicioWs, inicio))) return undefined;
  return `${content.slice(0, inicioWs)}&nbsp;${content.slice(inicio)}`;
}

/** ¿El espacio de `needle` ya quedó pegado con `&nbsp;` en una pasada anterior? */
export function yaAplicado(content: string, needle: string, inc: TypographyIncidence): boolean {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return false;
  const { inicio, fin } = idxs[0] as { inicio: number; fin: number };
  const antes = inc.type === 'repeated-first-letter';
  const pegote = antes ? content.slice(Math.max(0, inicio - 6), inicio) : content.slice(fin, fin + 6);
  // el markdown puede traer el espacio ya pegado con el carácter duro, no solo con la entidad
  const crudo = antes ? content[inicio - 1] : content[fin];
  return pegote === '&nbsp;' || crudo === '\u00a0';
}

export function normalizaParaBusqueda(texto: string): string {
  return sinComillasTipograficas(texto)
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: construye candidatos a partir del contexto
function cadenasDeBusqueda(inc: TypographyIncidence): string[] {
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

export type MotivoIncidencia = 'corregido' | 'no aplica' | 'múltiples coincidencias' | 'no encontrado' | 'sin coincidencia exacta';

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: heurística de fix por incidencia
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
  exactMiss: number;
  porPdf: Map<string, { incidences: TypographyIncidence[]; estado: Map<TypographyIncidence, MotivoIncidencia> }>;
}> {
  await aseguraGitLimpio(cwd);

  let corregidos = 0;
  let sinAplicar = 0;
  let noEncontradas = 0;
  let multiples = 0;
  let noAplica = 0;
  let exactMiss = 0;
  const porPdf = new Map<string, { incidences: TypographyIncidence[]; estado: Map<TypographyIncidence, MotivoIncidencia> }>();

  for (const pdf of targets) {
    const incidences = filtraExcepciones(
      await analyzePdf(pdf, analisis),
      etiqueta(cwd, pdf),
      cargarExcepciones(cwd, options),
    ) as TypographyIncidence[];
    if (incidences.length === 0) continue;

    const estado = new Map<TypographyIncidence, MotivoIncidencia>();
    porPdf.set(pdf, { incidences, estado });
    const fuentes = await candidatosDeFuente(cwd, pdf);
    if (fuentes.length === 0) {
      for (const inc of incidences) estado.set(inc, 'no encontrado');
      sinAplicar += incidences.length;
      noEncontradas += incidences.length;
      continue;
    }

    const contenido = new Map<string, string>();
    const contenidoNormalizado = new Map<string, string>();
    for (const f of fuentes) {
      try {
        const txt = await Bun.file(f).text();
        contenido.set(f, txt);
        contenidoNormalizado.set(f, normalizaParaBusqueda(txt));
      } catch {
        // se ignora una fuente ilegible
      }
    }

    for (const inc of incidences) {
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
      if (inc.type === 'single-word-line') {
        nuevo = envuelveParrafoContenedor(actual, inc);
      } else {
        nuevo = undefined;
        for (const cand of objetivos) {
          if (yaAplicado(actual, cand, inc)) break; // ya se pegó en una pasada anterior
          if (inc.type === 'consecutive-punctuation' || inc.type === 'repeated-last-letter') {
            nuevo = remplazaEspacioPosterior(actual, cand);
          } else if (inc.type === 'repeated-first-letter') {
            nuevo = remplazaEspacioAnterior(actual, cand);
          }
          if (nuevo !== undefined && nuevo !== actual) break;
        }
      }

      if (nuevo === undefined || nuevo === actual) {
        if (esTituloDeSeccion(actual, inc)) {
          estado.set(inc, 'no aplica');
          sinAplicar++;
          noAplica++;
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

  return { corregidos, sinAplicar, noEncontradas, multiples, noAplica, exactMiss, porPdf };
}
