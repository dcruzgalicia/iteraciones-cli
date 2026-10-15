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

export async function runTypography(cwd: string, args: string[], options: TypographyOptions = {}): Promise<void> {
  try {
    const analisis = opcionesDeAnalisis(options);
    const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
    const targets = args.length > 0 ? args.map((path) => resolvePath(cwd, path)) : await listPdfFiles(outputDir);
    if (targets.length === 0) throw new BuildError(`no hay PDFs en ${etiqueta(cwd, outputDir)}`);

    if (options.fix) {
      const { corregidos, sinAplicar } = await arreglaTypografia(cwd, targets, analisis);
      logInfo(`${corregidos} hallazgos corregidos, ${sinAplicar} sin aplicar`, 'typography');
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lectura de collection frontmatter
  const agregarFiles = async (ruta: string): Promise<void> => {
    try {
      const { yaml } = splitFrontmatter(await Bun.file(ruta).text());
      if (!yaml) return;
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown> | null;
      const files = parsed && Array.isArray(parsed.files) ? parsed.files.filter((x): x is string => typeof x === 'string') : [];
      const base = dirname(ruta);
      for (const f of files) {
        for (const c of [join(base, f), join(cwd, f)]) {
          if (await Bun.file(c).exists()) out.add(c);
        }
      }
    } catch {
      // mejor saltarse un frontmatter roto que abortar
    }
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

function indicesDe(haystack: string, aguja: string): number[] {
  const idxs: number[] = [];
  let from = 0;
  let at = haystack.indexOf(aguja, from);
  while (at !== -1) {
    idxs.push(at);
    from = at + aguja.length;
    at = haystack.indexOf(aguja, from);
  }
  return idxs;
}

function textoObjetivo(incidencia: TypographyIncidence): string {
  if (incidencia.type === 'single-word-line') return incidencia.text.trim();
  const ultima = incidencia.lineas.length > 0 ? incidencia.lineas[incidencia.lineas.length - 1] : undefined;
  return (ultima?.text ?? '').trim();
}

function estaEnFrontmatter(content: string, pos: number): boolean {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(content);
  if (!m) return false;
  return pos < m[0].length;
}

function profundidadFenced(content: string, pos: number): number {
  let dentro = false;
  for (const linea of content.slice(0, Math.max(0, pos)).split('\n')) {
    if (/^:{3,}/.test(linea)) dentro = !dentro;
  }
  return dentro ? 1 : 0;
}

function remplazaEspacioPosterior(content: string, needle: string): string | undefined {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return undefined;
  const i = idxs[0] as number;
  if (profundidadFenced(content, i) > 0 || estaEnFrontmatter(content, i)) return undefined;
  let j = i + needle.length;
  while (j < content.length && /\s/.test(content[j] ?? '')) j++;
  const ws = content.slice(i + needle.length, j);
  if (ws === '') return undefined; // ya está unido o no hay espacio que cambiar
  return `${content.slice(0, i + needle.length)}&nbsp;${content.slice(j)}`;
}

function remplazaEspacioAnterior(content: string, needle: string): string | undefined {
  const idxs = indicesDe(content, needle);
  if (idxs.length !== 1) return undefined;
  const i = idxs[0] as number;
  if (profundidadFenced(content, i) > 0 || estaEnFrontmatter(content, i)) return undefined;
  if (i === 0) return undefined;
  let j = i - 1;
  while (j >= 0 && /\s/.test(content[j] ?? '')) j--;
  const inicioWs = j + 1;
  if (inicioWs >= i) return undefined; // no hay espacio que cambiar
  return `${content.slice(0, inicioWs)}&nbsp;${content.slice(i)}`;
}

function envuelveParrafoUnitario(content: string, word: string): string | undefined {
  const bloques = content.split(/\n\s*\n/);
  const matches: number[] = [];
  for (let k = 0; k < bloques.length; k++) {
    if (bloques[k]?.trim() === word) matches.push(k);
  }
  if (matches.length !== 1) return undefined;
  const idx = matches[0] as number;
  const offsetBloque = content.indexOf(bloques[idx] as string);
  if (offsetBloque < 0 || profundidadFenced(content, offsetBloque) > 0 || estaEnFrontmatter(content, offsetBloque)) return undefined;
  if (bloques[idx]?.trim().startsWith(':::')) return undefined; // ya envuelto o bloque no puro
  bloques[idx] = `::: {runt=2}\n${word}\n:::`;
  return bloques.join('\n\n');
}

function normalizaParaBusqueda(texto: string): string {
  return texto
    .replace(/:::[^\n]*/g, ' ')
    .replace(/[*_`]+/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.match(/^\[([^\]]*)\]/)?.[1] ?? '')
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
  if (inc.type === 'single-word-line') {
    return [normalizaParaBusqueda(inc.text)].filter((f) => f.length >= 4);
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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: heurística de fix por incidencia
async function arreglaTypografia(cwd: string, targets: string[], analisis: OpcionesAnalisis): Promise<{ corregidos: number; sinAplicar: number }> {
  await aseguraGitLimpio(cwd);

  let corregidos = 0;
  let sinAplicar = 0;

  for (const pdf of targets) {
    const incidences = await analyzePdf(pdf, analisis);
    if (incidences.length === 0) continue;

    const fuentes = await candidatosDeFuente(cwd, pdf);
    if (fuentes.length === 0) {
      sinAplicar += incidences.length;
      logInfo(`${etiqueta(cwd, pdf)}: no se encontró markdown fuente`, 'typography');
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

    const saltados: TypographyIncidence[] = [];

    for (const inc of incidences) {
      const objetivo = textoObjetivo(inc);
      if (!objetivo) {
        saltados.push(inc);
        sinAplicar++;
        continue;
      }
      const frases = cadenasDeBusqueda(inc);
      let candidatos = [...contenido.keys()];
      const frasesUtiles = resuelveCandidatoFuentes(candidatos, contenidoNormalizado, frases);
      if (frasesUtiles.length === 0) {
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fallback global de candidatos
        const global = await (async () => {
          const found: string[] = [];
          const norm = new Map<string, string>();
          const raw = new Map<string, string>();
          const gg = new Bun.Glob('**/*.md');
          for await (const rel of gg.scan({ cwd, onlyFiles: true })) {
            const parts = rel.split('/');
            if (parts.some((p) => p === 'node_modules' || p === '.iteraciones' || p === 'dist' || p.startsWith('.'))) continue;
            const abs = join(cwd, rel);
            if (contenido.has(abs)) continue;
            try {
              const txt = await Bun.file(abs).text();
              const normalized = normalizaParaBusqueda(txt);
              raw.set(abs, txt);
              norm.set(abs, normalized);
              if (norm.get(abs)?.includes(frases[0] ?? '')) found.push(abs);
            } catch {
              // ignorar
            }
          }
          for (const [k, v] of raw) {
            if (!contenido.has(k)) {
              contenido.set(k, v);
              contenidoNormalizado.set(k, norm.get(k) ?? '');
            }
          }
          return found;
        })();
        candidatos = resuelveCandidatoFuentes([...contenido.keys()], contenidoNormalizado, frases);
        if (candidatos.length === 0) candidatos = global.slice(0, 1);
      } else {
        candidatos = frasesUtiles;
      }

      if (candidatos.length !== 1) {
        saltados.push(inc);
        sinAplicar++;
        logInfo(formatea(inc), 'typography');
        continue;
      }

      const ruta = candidatos[0] as string;
      const actual = contenido.get(ruta);
      if (actual === undefined) {
        sinAplicar++;
        continue;
      }

      let nuevo: string | undefined;
      if (inc.type === 'single-word-line') {
        nuevo = envuelveParrafoUnitario(actual, objetivo);
      } else if (inc.type === 'consecutive-punctuation' || inc.type === 'repeated-last-letter') {
        nuevo = remplazaEspacioPosterior(actual, objetivo);
      } else if (inc.type === 'repeated-first-letter') {
        nuevo = remplazaEspacioAnterior(actual, objetivo);
      } else {
        nuevo = undefined;
      }

      if (nuevo === undefined || nuevo === actual) {
        saltados.push(inc);
        sinAplicar++;
        logInfo(formatea(inc), 'typography');
        continue;
      }

      contenido.set(ruta, nuevo);
      corregidos++;
      logInfo(`corregido: ${relative(cwd, ruta)} ← "${objetivo.slice(0, 40)}${objetivo.length > 40 ? '…' : ''}"`, 'typography');
    }

    if (saltados.length > 0) {
      if (corregidos === 0 && saltados.length === incidences.length) {
        const lineas = [`${etiqueta(cwd, pdf)} · ${plural(saltados.length, 'incidencia')}`, ...saltados.map(formatea)];
        logInfo(lineas.join('\n'), 'typography');
      } else {
        for (const inc of saltados) logInfo(formatea(inc), 'typography');
      }
    }

    for (const [ruta, texto] of contenido) {
      if (texto !== (await Bun.file(ruta).text())) {
        await Bun.write(ruta, texto);
      }
    }
  }

  return { corregidos, sinAplicar };
}
