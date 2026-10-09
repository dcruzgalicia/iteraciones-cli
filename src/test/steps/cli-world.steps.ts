import { spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { After, Given, setDefaultTimeout, Then } from '@cucumber/cucumber';
import ignore from 'ignore';
import type { Snapshot } from '../../cli/preview.js';
import type { ProgressTracker } from '../../cli/progress.js';
import { initTestProject } from '../helpers.js';

setDefaultTimeout(120_000);

function nuevoMundo() {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,

    root: '',

    salidas: { build: 0, validate: 0 } as { build: number; validate: number },

    ultimoAviso: {} as Record<string, unknown>,

    latex: '',

    bibliografia: '',

    idioma: '',

    desactivados: undefined as string[] | undefined,

    cwd: '',

    config: null as unknown,

    configOpcional: undefined as unknown,
    configs: {} as Record<string, unknown>,

    errorConfig: '',

    presentes: new Set<string>() as ReadonlySet<string>,

    titulo: null as string | null,
    creadores: [] as string[],

    autorDeclarado: undefined as unknown,

    fallback: undefined as string | undefined,

    maxCreadores: undefined as number | undefined,
    rutaArchivo: '',
    nombrePrevio: undefined as string | undefined,

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
    ayudaOverrides: undefined as string | undefined,
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

    rutasGitignore: [] as string[],

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

    antesDe: '',
    desdeLinea: -1,

    entradasPreview: [] as string[],
    snapshotPrevio: undefined as Snapshot | undefined,
    snapshotNuevo: undefined as Snapshot | undefined,
    previewListo: undefined as unknown,
  };
}

export type World = ReturnType<typeof nuevoMundo>;

export const world: World = nuevoMundo();

export function tempRoot(prefijo: string): string {
  return mkdtempSync(join(tmpdir(), prefijo));
}

export function raiz(): string {
  if (!world.root) world.root = tempRoot('iteraciones-cli-');
  return world.root;
}

export function jsonSalida(): Record<string, unknown> {
  const crudo = world.stdout.trim();
  try {
    return JSON.parse(crudo) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`stdout no es JSON válido: ${(err as Error).message}\nva:\n${crudo}`);
  }
}

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
  if (world.root) rmSync(world.root, { recursive: true, force: true });

  Object.assign(world, nuevoMundo());
});

Given('que la raíz del proyecto está vacía', () => {
  world.root = tempRoot('iteraciones-cli-');
});

export function escribirEnProyecto(relativa: string, contenido: string): void {
  mkdirSync(dirname(join(world.root, relativa)), { recursive: true });
  writeFileSync(join(world.root, relativa), contenido, 'utf8');
}

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
  const veces = world.stderr.split(texto).length - 1;
  if (veces !== 1) {
    throw new Error(`esperaba ${JSON.stringify(texto)} una vez en stderr y apareció ${veces}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

const ESC = String.fromCharCode(27);

const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

export function sinColor(texto: string): string {
  return texto.replace(ANSI, '');
}
