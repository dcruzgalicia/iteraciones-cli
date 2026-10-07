import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const SCRIPT_DIR = ['.iteraciones', 'script'] as const;

type Section = 'images' | 'resources' | 'latex' | 'html' | 'epub' | 'post' | 'css' | 'pdf' | 'covers' | 'validate' | 'other';

const SECTIONS: ReadonlyArray<{ id: Section; title: string }> = [
  { id: 'images', title: 'Recursos: imágenes (ImageMagick)' },
  { id: 'resources', title: 'Recursos: plantillas, colecciones y assets (iteraciones)' },
  { id: 'latex', title: 'Pandoc: LaTeX' },
  { id: 'html', title: 'Pandoc: HTML' },
  { id: 'epub', title: 'Pandoc: EPUB' },
  { id: 'post', title: 'Salidas de iteraciones (post-proceso y markdown)' },
  { id: 'css', title: 'CSS (Tailwind)' },
  { id: 'pdf', title: 'PDF (latexmk)' },
  { id: 'covers', title: 'Portada (pdftoppm)' },
  { id: 'validate', title: 'Validación PDF/X' },
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

  inputTarget?: string;

  inputFrom?: Step;
  raw?: string;
  ext?: string;
  target?: string;
  intermediate?: boolean;
  comment?: string;
  order: number;
}

interface Capture {
  root: string;
  steps: Step[];
  seq: number;
}

let capture: Capture | null = null;

let pdfSlots = 0;

export function notePdfSlots(slots: number): void {
  pdfSlots = slots;
}

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function quote(value: string): string {
  return SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function displayPath(root: string, path: string): string {
  const rel = relative(root, path);
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

export function isScriptCapture(): boolean {
  return capture !== null;
}

function push(step: Omit<Step, 'order'>): void {
  if (capture === null) return;
  capture.steps.push({ ...step, order: capture.seq++ });
}

export function beginScriptCapture(root: string): void {
  capture = { root, steps: [], seq: 0 };
  pdfSlots = 0;
}

export function abortScriptCapture(): void {
  capture = null;
  pdfSlots = 0;
}

export interface ScriptExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  scriptKey?: string;

  inputTarget?: string;
}

export function recordScriptExec(command: string, args: string[], options: ScriptExecOptions, stdout: string): void {
  if (capture === null || isVersionProbe(args)) return;
  if (command === 'pandoc') recordPandoc(args, options, stdout);
  else if (command === 'magick') push({ section: 'images', sortKey: args.at(-1) ?? '', argv: [command, ...args] });
  else if (command === 'pdftoppm') push({ section: 'covers', sortKey: args.at(-1) ?? '', argv: [command, ...args] });
  else if (command === 'latexmk') {
    const job = args.find((a) => a.startsWith('-jobname='));

    push({ section: 'pdf', sortKey: job?.slice('-jobname='.length) ?? '', argv: [command, ...args], env: options.env });
  }
}

function recordPandoc(args: string[], options: ScriptExecOptions, stdout: string): void {
  const { section, ext } = formatOf(flagValue(args, '--to') ?? '');
  const output = flagValue(args, '--output');
  const argv = ['pandoc', ...args];
  const common = { section, argv, env: options.env, cwd: options.cwd, input: options.input, inputTarget: options.inputTarget };
  if (output !== undefined) push({ ...common, sortKey: output });
  else push({ ...common, sortKey: options.scriptKey ?? options.input ?? '', raw: stdout, ext });
}

export function recordSupportCommand(section: Section, sortKey: string, argv: string[], cwd?: string): void {
  push({ section, sortKey, argv, cwd });
}

export function resolveScriptStdout(raw: string, distPath: string | undefined, final: string, post?: string[]): void {
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
  if (distPath !== undefined && post !== undefined) push({ section: 'post', sortKey: distPath, argv: post, inputFrom: step });
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

export async function commitScriptCapture(): Promise<void> {
  const cap = capture;
  capture = null;
  if (cap === null) return;

  const steps = [...cap.steps].sort((a, b) => (a.sortKey === b.sortKey ? a.order - b.order : a.sortKey < b.sortKey ? -1 : 1));
  canonicalizePdfSlots(steps);
  markUnresolvedAsIntermediate(steps);

  const scriptDir = join(cap.root, ...SCRIPT_DIR);
  await mkdir(scriptDir, { recursive: true });
  await cleanGenerated(scriptDir);
  await assignPaths(steps, scriptDir);

  const scriptPath = join(cap.root, 'build.sh');
  const body = [...renderDirs(cap, steps, scriptDir), ...renderSections(cap, steps)];
  await writeFile(scriptPath, ['#!/bin/bash', 'set -e', `cd ${quote(cap.root)}`, ...body, ''].join('\n'), 'utf8');
  await chmod(scriptPath, 0o755);
}

function canonicalizePdfSlots(steps: Step[]): void {
  if (pdfSlots < 1) return;
  let ordinal = -1;
  let prevKey: string | undefined;
  for (const step of steps) {
    if (step.section !== 'pdf') continue;

    if (step.sortKey !== prevKey) {
      prevKey = step.sortKey;
      ordinal += 1;
    }
    const canonical = ordinal % pdfSlots;
    step.argv = step.argv.map((arg) => renumberSlotPath(arg, canonical));
    if (step.env !== undefined) {
      step.env = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, renumberSlotPath(value, canonical)]));
    }
  }
}

function renumberSlotPath(text: string, canonical: number): string {
  return text.replace(/\/(slot|cache)-\d+(?![.\w])/g, `/$1-${canonical}`);
}

function markUnresolvedAsIntermediate(steps: Step[]): void {
  for (const step of steps) {
    if (step.raw === undefined) continue;
    step.raw = undefined;
    step.intermediate = true;
    step.comment = '# la salida final la compone iteraciones; aquí queda la entrada cruda de pandoc';
  }
}

async function assignPaths(steps: Step[], scriptDir: string): Promise<void> {
  let inSeq = 0;
  let outSeq = 0;
  for (const step of steps) {
    if (step.input !== undefined) {
      const own = step.inputTarget;
      if (own === undefined) {
        inSeq += 1;
        step.inputPath = join(scriptDir, `in-${pad(inSeq)}.md`);
      } else {
        step.inputPath = own;
      }
      await mkdir(dirname(step.inputPath), { recursive: true });
      await writeFile(step.inputPath, step.input, 'utf8');
    }
    if (step.target === undefined && step.intermediate === true) {
      outSeq += 1;
      step.target = join(scriptDir, `out-${pad(outSeq)}${step.ext ?? ''}`);
    }
  }
}

export function prepareArgv(dirs: string[], xmpDirs: string[]): string[] {
  return ['iteraciones', 'prepare', ...dirs.flatMap((dir) => ['--dir', dir]), ...xmpDirs.flatMap((dir) => ['--xmp', dir])];
}

function renderDirs(cap: Capture, steps: Step[], scriptDir: string): string[] {
  const dirs = new Set<string>();
  for (const step of steps) {
    if (step.target !== undefined) dirs.add(dirname(step.target));
    const last = step.argv.at(-1);
    if (step.section === 'images' && last !== undefined) dirs.add(dirname(last));

    const i = step.argv.findIndex((a) => a === '-o' || a === '--output');
    const out = i >= 0 ? step.argv[i + 1] : undefined;
    if (out !== undefined) dirs.add(step.argv[1] === 'assets' || step.argv[1] === 'bundle' ? out : dirname(out));
  }

  dirs.delete(scriptDir);
  dirs.delete('.');
  if (dirs.size === 0) return [];

  const paths = [...dirs].sort().map((dir) => displayPath(cap.root, dir));
  return ['# === Preparación (directorios) ===', `mkdir -p ${paths.map(quote).join(' ')}`, ''];
}

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

function renderCommand(step: Step, cap: Capture): string {
  let cmd = step.argv.map(quote).join(' ');
  if (step.env !== undefined) {
    const prefix = Object.entries(step.env)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join(' ');
    cmd = `${prefix} ${cmd}`;
  }
  if (step.cwd !== undefined) cmd = `(cd ${quote(displayPath(cap.root, step.cwd))} && ${cmd})`;
  const stdin = step.inputFrom?.target ?? step.inputPath;
  if (stdin !== undefined) cmd += ` < ${quote(displayPath(cap.root, stdin))}`;
  if (step.target !== undefined) cmd += ` > ${quote(displayPath(cap.root, step.target))}`;
  return cmd;
}
