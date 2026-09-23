import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

/**
 * #2438 — grabación de los comandos externos que ejecuta un build.
 *
 * Con `format.script: true` cada build reescribe `build.sh` en la raíz del
 * proyecto con los comandos EXTERNOS que corrieron en esa corrida: pandoc,
 * magick, latexmk y los `mkdir`/`cp`/`rm`/`mv` de soporte de latexmk. El .sh
 * contiene solo comandos: la lógica de iteraciones no se transcribe, se deja
 * como comentario cuando el archivo final de dist la requiere.
 *
 * Reglas:
 * - solo graba quien llama a `beginScriptCapture` (format.script) y solo
 *   comandos que terminaron con exit 0;
 * - pandoc sin `--output` (latex/html) alimenta su stdin desde un archivo
 *   materializado en `.iteraciones/script/in-NNNN.md`;
 * - el destino de ese stdout lo decide `resolveScriptStdout`: a `dist/...` si
 *   el byte final es idéntico a la salida cruda, a
 *   `.iteraciones/script/out-NNNN.*` con comentario si iteraciones lo
 *   transforma. El .sh nunca escribe por encima de un archivo que compone
 *   iteraciones;
 * - `commitScriptCapture` corre solo si el build terminó bien; si falla,
 *   `abortScriptCapture` deja el build.sh anterior intacto.
 */

const SCRIPT_DIR = ['.iteraciones', 'script'] as const;

type Section = 'images' | 'latex' | 'html' | 'epub' | 'pdf' | 'other';

const SECTIONS: ReadonlyArray<{ id: Section; title: string }> = [
  { id: 'images', title: 'Procesamiento de imágenes (ImageMagick)' },
  { id: 'latex', title: 'Pandoc: LaTeX' },
  { id: 'html', title: 'Pandoc: HTML' },
  { id: 'epub', title: 'Pandoc: EPUB' },
  { id: 'pdf', title: 'PDF (latexmk)' },
  { id: 'other', title: 'Otros comandos' },
];

interface Step {
  section: Section;
  sortKey: string;
  argv: string[];
  env?: Record<string, string>;
  cwd?: string;
  input?: string;
  inputPath?: string;
  raw?: string;
  ext?: string;
  target?: string;
  intermediate?: boolean;
  comment?: string;
  order: number;
}

interface Capture {
  root: string;
  processCwd: string;
  steps: Step[];
  seq: number;
}

let capture: Capture | null = null;

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function quote(value: string): string {
  return SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Ruta legible respecto del cwd con que corrió el build; si cae fuera, absoluta. */
function displayPath(processCwd: string, path: string): string {
  const rel = relative(processCwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function formatOf(to: string): { section: Section; ext: string } {
  if (to.startsWith('latex')) return { section: 'latex', ext: '.tex' };
  if (to.startsWith('html')) return { section: 'html', ext: '.html' };
  if (to.startsWith('epub')) return { section: 'epub', ext: '.epub' };
  return { section: 'other', ext: '.txt' };
}

function isVersionProbe(args: string[]): boolean {
  return args.some((a) => a === '--version' || a === '-version' || a === '-v');
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

function push(step: Omit<Step, 'order'>): void {
  if (capture === null) return;
  capture.steps.push({ ...step, order: capture.seq++ });
}

export function beginScriptCapture(root: string): void {
  capture = { root, processCwd: process.cwd(), steps: [], seq: 0 };
}

export function abortScriptCapture(): void {
  capture = null;
}

export interface ScriptExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  scriptKey?: string;
}

/**
 * Registra un comando externo terminado con éxito (hook único desde `exec`).
 * Los comandos que no producen artefactos (versiones, validadores) se ignoran.
 */
export function recordScriptExec(command: string, args: string[], options: ScriptExecOptions, stdout: string): void {
  if (capture === null || isVersionProbe(args)) return;
  if (command === 'pandoc') recordPandoc(args, options, stdout);
  else if (command === 'magick') push({ section: 'images', sortKey: args.at(-1) ?? '', argv: [command, ...args] });
  else if (command === 'latexmk') {
    const job = args.find((a) => a.startsWith('-jobname='));
    push({ section: 'pdf', sortKey: job?.slice('-jobname='.length) ?? '', argv: [command, ...args], env: options.env, cwd: options.cwd });
  }
}

/** pandoc con `--output` ya trae su destino en argv; sin él, el stdout se resuelve después. */
function recordPandoc(args: string[], options: ScriptExecOptions, stdout: string): void {
  const { section, ext } = formatOf(flagValue(args, '--to') ?? '');
  const output = flagValue(args, '--output');
  const argv = ['pandoc', ...args];
  const common = { section, argv, env: options.env, cwd: options.cwd, input: options.input };
  if (output !== undefined) push({ ...common, sortKey: output });
  else push({ ...common, sortKey: options.scriptKey ?? options.input ?? '', raw: stdout, ext });
}

/** Ordena dentro de su sección por `sortKey` (estable en corridas concurrentes). */
export function recordSupportCommand(section: Section, sortKey: string, argv: string[]): void {
  push({ section, sortKey, argv });
}

/**
 * Decide adónde apunta el stdout de un paso de pandoc: a `distPath` si el
 * archivo final es byte-idéntico a la salida cruda, o a un intermedio de
 * `.iteraciones/script/` con comentario si iteraciones lo transforma.
 */
export function resolveScriptStdout(raw: string, distPath: string | undefined, final: string): void {
  if (capture === null) return;
  const step = capture.steps.find((s) => s.raw !== undefined && s.raw === raw);
  if (step === undefined) return;
  step.raw = undefined;
  if (distPath !== undefined && final === raw) {
    step.target = distPath;
    return;
  }
  step.intermediate = true;
  step.comment =
    distPath === undefined
      ? '# la salida final la compone iteraciones; aquí queda la entrada cruda de pandoc'
      : `# ${distPath}: lo compone iteraciones (pasos posteriores a pandoc); la entrada cruda queda aquí`;
}

async function cleanGenerated(scriptDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(scriptDir);
  } catch {
    return;
  }
  await Promise.all(entries.filter((n) => /^(in|out)-\d+\./.test(n)).map((n) => rm(join(scriptDir, n), { force: true })));
}

/** Escribe `build.sh` (ejecutable) con los pasos de esta corrida. */
export async function commitScriptCapture(): Promise<void> {
  const cap = capture;
  capture = null;
  if (cap === null) return;

  const steps = [...cap.steps].sort((a, b) => (a.sortKey === b.sortKey ? a.order - b.order : a.sortKey < b.sortKey ? -1 : 1));
  markUnresolvedAsIntermediate(steps);

  const scriptDir = join(cap.root, ...SCRIPT_DIR);
  await mkdir(scriptDir, { recursive: true });
  await cleanGenerated(scriptDir);
  await assignPaths(steps, scriptDir);

  const scriptPath = join(cap.root, 'build.sh');
  const body = [...renderDirs(cap, steps, scriptDir), ...renderSections(cap, steps)];
  await writeFile(scriptPath, ['#!/bin/bash', 'set -e', `cd ${quote(cap.processCwd)}`, ...body, ''].join('\n'), 'utf8');
  await chmod(scriptPath, 0o755);
}

/**
 * Un stdout que nadie resolvió (no tenía archivo final en dist) va a un
 * intermedio: el .sh nunca escribe por encima de lo que compone iteraciones.
 */
function markUnresolvedAsIntermediate(steps: Step[]): void {
  for (const step of steps) {
    if (step.raw === undefined) continue;
    step.raw = undefined;
    step.intermediate = true;
    step.comment = '# la salida final la compone iteraciones; aquí queda la entrada cruda de pandoc';
  }
}

/** Numeración de entradas e intermedios, en orden ya establecido → determinista. */
async function assignPaths(steps: Step[], scriptDir: string): Promise<void> {
  let inSeq = 0;
  let outSeq = 0;
  for (const step of steps) {
    if (step.input !== undefined) {
      inSeq += 1;
      step.inputPath = join(scriptDir, `in-${pad(inSeq)}.md`);
      await writeFile(step.inputPath, step.input, 'utf8');
    }
    if (step.target === undefined && step.intermediate === true) {
      outSeq += 1;
      step.target = join(scriptDir, `out-${pad(outSeq)}${step.ext ?? ''}`);
    }
  }
}

/** Directorios que el .sh escribe: el build los creó antes de cada salida. */
function renderDirs(cap: Capture, steps: Step[], scriptDir: string): string[] {
  const dirs = new Set<string>();
  for (const step of steps) {
    if (step.target !== undefined) dirs.add(dirname(step.target));
    const last = step.argv.at(-1);
    if (step.section === 'images' && last !== undefined) dirs.add(dirname(last));
  }
  // El propio .iteraciones/script lo crea la generación del build.sh.
  dirs.delete(scriptDir);
  if (dirs.size === 0) return [];
  const lines = [...dirs].sort().map((dir) => `mkdir -p ${quote(displayPath(cap.processCwd, dir))}`);
  return ['# === Directorios de salida ===', ...lines, ''];
}

/** Bloques de sección separados en blanco; las secciones vacías no salen. */
function renderSections(cap: Capture, steps: Step[]): string[] {
  const blocks: string[] = [];
  for (const { id, title } of SECTIONS) {
    const block = steps.filter((s) => s.section === id);
    if (block.length === 0) continue;
    const lines = [`# === ${title} ===`];
    for (const step of block) {
      if (step.comment !== undefined) lines.push(step.comment);
      lines.push(renderCommand(step, cap));
    }
    blocks.push('', ...lines);
  }
  return blocks;
}

/** Una línea del .sh: env, subshell de cwd, entrada por stdin y salida redirigida. */
function renderCommand(step: Step, cap: Capture): string {
  let cmd = step.argv.map(quote).join(' ');
  if (step.env !== undefined) {
    const prefix = Object.entries(step.env)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join(' ');
    cmd = `${prefix} ${cmd}`;
  }
  if (step.cwd !== undefined) cmd = `(cd ${quote(displayPath(cap.processCwd, step.cwd))} && ${cmd})`;
  if (step.inputPath !== undefined) cmd += ` < ${quote(displayPath(cap.processCwd, step.inputPath))}`;
  if (step.target !== undefined) cmd += ` > ${quote(displayPath(cap.processCwd, step.target))}`;
  return cmd;
}
