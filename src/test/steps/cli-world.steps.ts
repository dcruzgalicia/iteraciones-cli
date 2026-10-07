import { spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { After, Given, setDefaultTimeout, Then } from '@cucumber/cucumber';
import ignore from 'ignore';
import type { ProgressTracker } from '../../cli/progress.js';
import { initTestProject } from '../helpers.js';

/**
 * #2546 (onda 2) — el mundo compartido de los features del CLI.
 *
 * `parser`, `--project-root` y `new` hacen todos lo mismo: correr algo que
 * escribe en la terminal y mirar qué salió. Por eso el mundo y el `Then` están
 * aquí y no en cada step file — el mismo motivo que dejó `lua-world.ts` en la
 * onda 1: si cada archivo declarara su propio `world`, el `Then` quedaría
 * definido dos veces y cucumber reportaría `ambiguous`.
 *
 * ## Por qué `capture()` espía los dos streams
 *
 * Los errores de uso de commander van a **stderr**, pero `--help` también sale
 * por `CommanderError` y escribe en **stdout**, porque es ayuda y no un error.
 * Un helper que sólo espiara uno de los dos se rompería al halfway de la
 * migración, y el fallo se presentaría como "el CLI no imprimió nada".
 *
 * ## El código de salida tiene dos fuentes y este archivo las une
 *
 * - camino 1: un error de uso lanza `CommanderError` con su `exitCode`;
 * - camino 2: la validación de `--output` no lanza nada — corre en un hook del
 *   programa, escribe el mensaje y pone `process.exitCode`.
 *
 * Por eso `capture()` mira `process.exitCode` después del `await`, y el `When`
 * que sí recibe la excepción la sobreescribe. El `Then` lee un solo lugar y no
 * necesita saber por dónde pasó la salida.
 */

/**
 * El default de cucumber son 5 s por paso. Los pasos de este bloque compilan un
 * PDF de verdad cuando el proyecto pide formato PDF: LaTeX se lleva 2-4 s en una
 * máquina descargada, y el merge-gate corre `bun test`, `gherkin` y `build +
 * visual check` EN PARALELO, así que con 5 s los escenarios de humo de PDF
 * expiraban de forma intermitente. El original ya lo sabía: los `it()` de humo
 * llevaban `{ timeout: 120_000 }`.
 *
 * Una línea y no seis: los pasos que compilan están repartidos en tres
 * archivos, y subir el default no le quita poder de detección — sólo tarda más
 * en reportar un paso colgado.
 */
setDefaultTimeout(120_000);

/**
 * El mundo entero del escenario, en un solo sitio.
 *
 * Es una fábrica y no un `const` suelto porque el `After` lo restaura entero con
 * `Object.assign`, y cada llamada devuelve los `Set`/`Map` nuevos: compartir los
 * del literal dejaría dentro los cambios del escenario anterior.
 *
 * La lista vivía una vez aquí y el hook la repetía a mano, que es como se le
 * colaron 29 campos. Añadir un campo es añadirlo en un sitio.
 */
function nuevoMundo() {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    /** Raíz temporal del escenario. La vacía cada `Given` de proyecto. */
    root: '',
    /** Códigos de salida de una corrida que lanza los dos comandos. */
    salidas: { build: 0, validate: 0 } as { build: number; validate: number },
    /** Lo que dejó el último `Then` que filtró una lista, para el `Then` que viene después. */
    ultimoAviso: {} as Record<string, unknown>,
    /** El `.tex` que compuso el último paso del preámbulo. */
    latex: '',
    /** La ruta de la bibliografía con nombre awkward del escenario activo. */
    bibliografia: '',
    /** El idioma que eligió el último `Given`. */
    idioma: '',
    /** La disabled list del escenario activo. `undefined` es "sin lista". */
    desactivados: undefined as string[] | undefined,
    /** El directorio del proyecto cuando un filtro se reemplaza desde el `.tex` propio. */
    cwd: '',
    /** La configuración que cargó el loader, o `null` si la carga falló. */
    config: null as unknown,
    /** El resultado de `loadSiteConfigIfPresent`: `null` si no hay archivo. */
    configOpcional: undefined as unknown,
    configs: {} as Record<string, unknown>,
    /** El mensaje del `ConfigError` que tiró la carga, o cadena vacía. */
    errorConfig: '',
    /** Las claves que el autor ESCRIBIÓ, no las que el paquete puso por defecto. */
    presentes: new Set<string>() as ReadonlySet<string>,
    /** El frontmatter del documento del escenario de descubrimiento. */
    titulo: null as string | null,
    creadores: [] as string[],
    /** El `creator` tal como lo escribió el autor: string, lista o nada. */
    autorDeclarado: undefined as unknown,
    /** La ruta que se usa como base cuando el documento no tiene título. */
    fallback: undefined as string | undefined,
    /** Cuántos autores caben en el nombre cuando el autor lo sube. */
    maxCreadores: undefined as number | undefined,
    rutaArchivo: '',
    nombrePrevio: undefined as string | undefined,
    /** El nombre que calculated el último paso, sea de salida o de HTML. */
    nombre: undefined as string | undefined,
    listaAutores: [] as string[],
    texto: '',
    yaml: undefined as string | undefined,
    cuerpo: '',
    raizRaiz: '',
    cuerpoDoc: '',
    contenido: '',
    tracker: null as ProgressTracker | null,
    salidaProgreso: '',
    fasesProgreso: [] as string[],
    avisosProgreso: [] as string[],
    hooksNuevos: 0,
    tubeProgreso: false,
    espia: null as { mock: { calls: unknown[][] }; mockRestore: () => void } | null,
    hayIndex: false,
    fasesCorrieron: '',
    bufferProgreso: null as string[] | null,
    estadoCargado: undefined as unknown,
    pendiente: null as unknown,
    bibliografiaConfig: undefined as string | undefined,
    opcionesBib: undefined as unknown,
    errorBib: '',
    bibs: [] as string[],
    hashBib: undefined as string | undefined,
    hashArchivo: undefined as unknown,
    cachePrevia: undefined as Record<string, { mtime: number; size: number; hash: string }> | undefined,
    cacheSalida: {} as Record<string, { mtime: number; size: number; hash: string }>,
    errorHash: '',
    camposPortada: {} as Record<string, unknown>,
    portada: [] as { absPath: string; isSvg: boolean }[],
    pdfxActivo: false,
    pagina: { w: 140, h: 216, textW: 110 },
    cajas: {} as unknown,
    plantilla: '',
    filtroPreguntado: '',
    sugerencia: undefined as string | undefined,
    desactivadosFiltros: undefined as string[] | undefined,
    avisosFiltros: [] as string[],
    capas: {} as unknown,
    grupos: {} as unknown,
    usuarios: [] as string[],
    filtrosDesactivados: undefined as string[] | undefined,
    png: undefined as Uint8Array | undefined,
    ordenadas: [] as string[],
    pdfs: [] as string[],
    workspaces: {} as unknown,
    opcionesVisuales: null as unknown,
    errorVisual: '',
    comparacion: {} as unknown,
    informe: '',
    resumen: [] as string[],
    cuerpoVoc: '',
    offsetColones: undefined as number | undefined,
    colones: [] as number[],
    avisoColones: '',
    configCargado: null as unknown,
    hashPrevio: undefined as string | undefined,
    hashActual: undefined as string | undefined,
    hashFiltrosPrevio: undefined as string | undefined,
    hashFiltrosObjeto: undefined as unknown,
    hashBibObjeto: undefined as unknown,
    hashBibPrevio: undefined as string | undefined,
    mtimeEstado: 0,
    errClase: '',
    errMensaje: '',
    errCodigo: '',
    errValor: undefined as string | undefined,
    errHint: undefined as string | undefined,
    errFormatado: undefined as unknown,
    bibFiles: [] as string[],
    desactivadosBib: [] as string[],
    bibFilesSinCalcular: false,
    texBib: '',
    biblatexDisponible: false,
    estadoBib: undefined as boolean | undefined,
    argumentosLatexmk: '',
    pathOriginal: undefined as string | undefined,
    cuerpoOrigen: '',
    metaExport: {} as Record<string, unknown>,
    exportLeido: '',
    exportOriginal: '',
    formatosPedidos: undefined as Record<string, { generate: boolean; merge?: boolean }> | undefined,
    formatosActivosCalc: [] as string[],
    errorLectura: '',
    codigoValidate: 0,
    stderrValidate: '',
    codigoMerge: 0,
    textoMerge: '',
    textoDictum: '',
    desplazamientoDictum: undefined as number | undefined,
    avisosDictum: [] as unknown[],
    qrMarkdown: '',
    texQr: '',
    rutaJpgQr: '',
    marcadorPwned: '',
    arbolDist: [] as string[],
    hashFiltros: undefined as string | undefined,
    cacheFiltros: {} as Record<string, unknown>,
    hashConfigPrevio: undefined as unknown,
    hashConfigActual: undefined as unknown,
    mapaImagenes: new Map<string, string>() as ReadonlyMap<string, string>,
    imagenSinProcesar: '',
    rutas: {} as unknown,
    namer: null as ((ruta: string) => string) | null,
    nombreActual: '',
    enLinea: [] as string[],
    miembros: [] as { file: string; title: string; creator: string[]; body: string }[],
    cuerpoColeccion: '',
    rutaColeccion: 'coleccion.md',
    html: '',
    enlaces: new Map<string, string>() as ReadonlyMap<string, string>,
    fragmento: '',
    filtro: undefined as { name: string; content: string } | undefined,
    filtroNombre: '',
    filtroPareja: undefined as { name: string; content: string } | undefined,
    filtroParejaNombre: '',
    filtrosDinamica: [] as { name: string; content: string }[],
    filtrosOriginales: [] as { name: string; content: string }[],
    papel: {} as unknown,
    crop: undefined as string | undefined,
    pdfx: undefined as string | undefined,
    conCrop: false,
    htmlEntrada: '',
    htmlSalida: '',
    bloqueRefs: undefined as string | undefined,
    formatos: [] as { href: string; key: 'pdf' | 'epub' | 'latex' | 'markdown'; name: string; description: string }[],
    flagFormatos: undefined as string | undefined,
    argsFormatos: [] as string[],
    avisosHtml: [] as string[],
    erroresFm: [] as { severity: string; message: string }[],
    documentosProyecto: {} as Record<string, string>,
    configPdfx: undefined as unknown,
    resultadoPdfx: undefined as unknown,
    mensajePdfx: '',
    espiaStderr: null as { mock: { calls: unknown[][] }; mockRestore: () => void } | null,
    sinHerramientas: [] as string[],
    featureGating: '',
    omitidas: [] as string[],
    pool: null as unknown,
    slotsPool: 2,
    esperaPool: 0,
    llamadasPool: [] as string[],
    concurrentesPool: 0,
    maxConcurrentesPool: 0,
    fasesPool: [] as string[],
    progresoRoto: false,
    productorTerminado: false,

    indice: new Map<string, unknown>() as Map<string, unknown>,
    reglasGitignore: ignore() as ReturnType<typeof import('ignore')>,
    /** Las rutas que la paridad consulta a los dos motores. */
    rutasGitignore: [] as string[],
    /** El `.gitignore` tal como lo escribió el autor, antes de parsearlo. */
    reglasTexto: '',
    rutasDescubiertas: [] as string[],
    errorConstruccion: '',
    issuesFrontmatter: [] as { severity: string; message: string }[],
    entradasColeccion: [] as unknown[],
    htmlColeccion: '',
    stderrConstruccion: '',
    codigoBuild: 0,
    stderrBuild: '',
    jsonBuild: {} as Record<string, unknown>,
    itemsRun: [] as number[],
    itemQueFalla: Number.NaN,
    itemsQueFallan: [] as number[],
    procesadosRun: [] as number[],
    concurrentesRun: 0,
    maxConcurrentesRun: 0,
    cancelesRun: 0,
    resultadoRun: undefined as unknown,
    erroresRun: '',
    errorProceso: '',
    esProcesoTimeout: false,
    resultadoProceso: undefined as unknown,
    fechaDoc: '',
    fechaLegible: undefined as string | undefined,
    pluralResultado: '',
    documentoExport: undefined as unknown,
    export: undefined as unknown,
    nivelFm: {} as Record<string, unknown>,
    nivelFmt: undefined as Record<string, unknown> | undefined,
    nivelRoot: {} as Record<string, unknown>,
    valorCampo: undefined as unknown,
    leido: undefined as unknown,
    campoResuelto: '',
    cambiados: new Set<string>() as Set<string>,
    slugsCambiados: new Map<string, string>() as Map<string, string>,
    stderrSlug: '',
    ttyProgreso: undefined as unknown,
    trozosProgreso: [] as string[],
    hooksPrevios: [] as unknown[],
    codigoVisual: 0,
    stdoutVisual: '',
    stderrVisual: '',
    raizProyecto: '',
    texRelativizado: '',
    texLocalizado: '',
    copias: [] as unknown[],
    errorBuild: '',
    docsPlan: [] as unknown[],
    formatosActivos: [] as string[],
    formatosPrevios: [] as string[],
    invalidaciones: {} as Record<string, boolean>,
    docsCambiados: new Set<string>() as Set<string>,
    /** Los formatos que este build pide y el anterior no: se acumulan, no se pisan. */
    formatoNuevo: [] as string[],
    trabajo: undefined as unknown,
    metadata: undefined as unknown,
    slugBorrado: '',
    rutaBorrada: '',
    borrados: new Set<string>() as Set<string>,
    cambioSlug: '',
    formatosQuitados: [] as string[],
    mtimeLogo: 0,
    estadoAntes: {} as Record<string, unknown>,
    stderrCache: '',
    camposXmp: {} as Record<string, unknown>,
    xmp: '',
    infoPdf: '',
    texXmp: '',
    texInyectado: '',
    exitCodeConstruccion: 0,
    pathsSeleccion: [] as string[],
    distReferencia: {} as Record<string, string>,
    nombresPreambulo: [] as string[],
    nombresPreambuloFile: [] as string[],
    rutasIndex: [] as string[],
    parseo: {} as { value?: unknown; error?: string },
    documentos: [] as { relativePath: string; filePath: string; frontmatter: { title?: string; creator?: string[]; date?: string } }[],
    /** Los dos extremos de una comparación de orden, uno por docstring. */
    antesDe: '',
    desdeLinea: -1,
  };
}

export type World = ReturnType<typeof nuevoMundo>;

/**
 * El mundo del escenario activo. El `After` lo devuelve al estado inicial; por
 * eso los 61 archivos de steps importan ESTE objeto y no una copia: si cada uno
 * guardara el suyo, el `Then` compartido quedaría ambiguous.
 */
export const world: World = nuevoMundo();

/**
 * Los pasos de proyecto arman su propio temporal con `mkdtemp`: los de
 * contenido de archivo son SÍNCRONOS (ver la nota de cucumber-js en el doc de
 * `capture`), y un `mkdtemp` asíncrono los volvería `async`.
 */
export function tempRoot(prefijo: string): string {
  return mkdtempSync(join(tmpdir(), prefijo));
}

/**
 * Corre `fn` con los dos streams espiados y deja el resultado en el mundo.
 * No captura excepciones: quien llama decide qué hacer con ellas.
 */
export async function capture(fn: () => Promise<void>): Promise<void> {
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  world.stdout = '';
  world.stderr = '';
  process.exitCode = 0;
  try {
    await fn();
    world.exitCode = process.exitCode ?? 0;
  } finally {
    world.stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    world.stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

After(() => {
  // Los steps que crean la raíz no se acordan de limpiar nada. El paso que
  // deja un directorio sin permisos lo devuelve antes de terminar.
  if (world.root) rmSync(world.root, { recursive: true, force: true });
  // El mundo entero, de una vez. El hook anterior listaba los ~250 campos a
  // mano: se le colaban 29 (el escenario siguiente heredaba `xmp`,
  // `slugBorrado`, `estadoAntes`…) y repetía 26 líneas. `nuevoMundo()` es la
  // única copia de la lista.
  Object.assign(world, nuevoMundo());
});

Given('que la raíz del proyecto está vacía', () => {
  world.root = tempRoot('iteraciones-cli-');
});

/** Escribe un archivo bajo la raíz del proyecto, creando los directorios. */
export function escribirEnProyecto(relativa: string, contenido: string): void {
  mkdirSync(dirname(join(world.root, relativa)), { recursive: true });
  writeFileSync(join(world.root, relativa), contenido, 'utf8');
}

/**
 * El proyecto de referencia: una config mínima de HTML y un documento con
 * frontmatter. Lo usan `validate`, `clean` y `init` por igual, así que el
 * `Given` es compartido — y es el helper de `test/helpers.ts`, no una copia.
 */
Given('que la raíz del proyecto tiene un proyecto de prueba', () => {
  world.root = tempRoot('iteraciones-cli-');
  initTestProject(world.root);
});

Then('el comando termina con el código de salida {int}', (codigo: number) => {
  if (world.exitCode !== codigo) {
    throw new Error(`esperaba código de salida ${codigo} y hubo ${world.exitCode}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el error dice {string}', (esperado: string) => {
  const limpio = sinColor(world.stderr);
  if (!limpio.includes(esperado)) {
    throw new Error(`el error no dice ${JSON.stringify(esperado)}. stderr: ${JSON.stringify(limpio)}`);
  }
});

Then('el error no dice {string}', (ruido: string) => {
  const limpio = sinColor(world.stderr);
  if (limpio.includes(ruido)) {
    throw new Error(`el error sí dice ${JSON.stringify(ruido)} y no debería: ${JSON.stringify(limpio)}`);
  }
});

Then('la salida de error no lleva ningún aviso', () => {
  // Un `⚠` acá sería un aviso que el CLI se está dando a sí mismo sobre un
  // nombre de archivo que es perfectamente válido.
  if (world.stderr.includes('⚠')) {
    throw new Error(`la salida lleva un aviso que no debería: ${JSON.stringify(world.stderr)}`);
  }
});

Then('la salida dice {string}', (esperado: string) => {
  if (!world.stdout.includes(esperado)) {
    throw new Error(`la salida no dice ${JSON.stringify(esperado)}. stdout: ${JSON.stringify(world.stdout)}`);
  }
});

Then('el error menciona {string} una sola vez', (texto: string) => {
  // El nombre del archivo repetido hace que un error parezca dos distintos, y
  // el usuario va a buscarlos por separado. Cuenta sobre stderr, que es donde
  // viven los errores del CLI.
  const veces = world.stderr.split(texto).length - 1;
  if (veces !== 1) {
    throw new Error(`esperaba ${JSON.stringify(texto)} una vez en stderr y apareció ${veces}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

/**
 * Sin los códigos ANSI.
 *
 * El logger colorea `✖` y `[build]` por separado, así que en un terminal el
 * texto plano `"✖ [build] --output"` NO aparece: lo que sale es
 * `\x1b[31m✖\x1b[0m \x1b[2m[build]\x1b[0m--output`. Un `includes` sobre la cadena
 * con color falla en terminal y pasa por tubería, que es la forma más difícil de
 * depurar que existe: el test es verde en CI y rojo en la máquina del autor.
 *
 * Por eso las aserciones comparan el TEXTO, nunca la decoración del terminal.
 */
const ESC = String.fromCharCode(27);

/** La regex se construye a partir del código de carácter: biome rechaza un
 * control character en el literal, y escribirlo crudo además lo vuelve
 * invisible en el diff. */
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

export function sinColor(texto: string): string {
  return texto.replace(ANSI, '');
}
