import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildReporter } from '../builder/types.js';
import { nombreCortado, type TypographyIncidence } from '../lib/pdf-typography.js';

export function initTestProject(dir: string): void {
  writeFileSync(
    join(dir, 'iteraciones.config.yaml'),
    ['language: es-MX', 'format:', '  html:', '    site:', '      title: Test', '    generate: true'].join('\n'),
    'utf8',
  );
  writeFileSync(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n', 'utf8');
}

export function distPath(root: string, ...parts: string[]): string {
  return join(root, 'dist', 'files', ...parts);
}

export function exigeTexto(contenido: string, archivo: string, textos: string[]): void {
  for (const texto of textos) {
    if (!contenido.includes(texto)) throw new Error(`${archivo} no contiene ${JSON.stringify(texto)}`);
  }
}

export function prohibeTexto(contenido: string, archivo: string, textos: string[]): void {
  for (const texto of textos) {
    if (contenido.includes(texto)) throw new Error(`${archivo} contiene ${JSON.stringify(texto)} y no debería`);
  }
}

export function describeIncidencia(incidencia: TypographyIncidence): string {
  if (incidencia.type === 'single-word-line') {
    return `single-word-line ;; pág ${incidencia.page} ;; línea ${incidencia.line} ;; ${incidencia.text.trim()}`;
  }
  if (incidencia.type === 'hyphenated-proper-noun') {
    return `hyphenated-proper-noun ;; pág ${incidencia.page} ;; línea ${incidencia.line} ;; ${nombreCortado(incidencia)}`;
  }
  if (incidencia.type === 'stretched-line' || incidencia.type === 'shrunk-line') {
    return `${incidencia.type} ;; pág ${incidencia.page} ;; línea ${incidencia.line} ;; ratio ${incidencia.ratio.toFixed(2)} ;; gap ${incidencia.gapPt.toFixed(1)} ;; ${incidencia.text.trim()}`;
  }
  if (incidencia.type === 'river') {
    return `river ;; pág ${incidencia.page} ;; líneas ${incidencia.from}-${incidencia.to} ;; x ${incidencia.xPt.toFixed(1)} ;; canal ${incidencia.channelPt.toFixed(1)} ;; ${incidencia.text.trim()} || ${incidencia.lastText.trim()}`;
  }
  const numeros = incidencia.lineas.map((l) => l.line);
  const rango = `líneas ${numeros[0]}-${numeros.at(-1)}${incidencia.total > incidencia.lineas.length ? ` de ${incidencia.total}` : ''}`;
  const cuerpo = incidencia.lineas.map((l) => `${l.line}: ${l.text.trim()}`).join(' || ');
  const letra = incidencia.type === 'consecutive-punctuation' ? '' : ` ;; ${incidencia.letter}`;
  return `${incidencia.type} ;; pág ${incidencia.page} ;; ${rango}${letra} ;; ${cuerpo}`;
}

type ReporterCall = { method: string; args: unknown[] };

export function fakeReporter(): {
  reporter: BuildReporter;
  calls: ReporterCall[];
  logs: string[];
  files: string[];
} {
  const calls: ReporterCall[] = [];
  const logs: string[] = [];
  const files: string[] = [];
  const reporter: BuildReporter = {
    setFormats: (formats) => void calls.push({ method: 'setFormats', args: [formats] }),
    startPhase: (phase, total) => void calls.push({ method: 'startPhase', args: [phase, total] }),
    reportFile: (file) => {
      files.push(file.relativePath);
      calls.push({ method: 'reportFile', args: [file] });
    },
    completePhase: (count, phase) => void calls.push({ method: 'completePhase', args: [count, phase] }),
    log: (message) => {
      logs.push(message);
      calls.push({ method: 'log', args: [message] });
    },
    addWarning: (message) => void calls.push({ method: 'addWarning', args: [message] }),
    addSummaryLine: (line) => void calls.push({ method: 'addSummaryLine', args: [line] }),
    showCleanup: () => void calls.push({ method: 'showCleanup', args: [] }),
    startLightFormats: () => void calls.push({ method: 'startLightFormats', args: [] }),
    finish: async (processed, cached) => void calls.push({ method: 'finish', args: [processed, cached] }),
    fail: async () => void calls.push({ method: 'fail', args: [] }),
  };
  return { reporter, calls, logs, files };
}

export function systemCommands(script: string): string[] {
  const found = new Set<string>();
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('set ') || line.startsWith('cd ') || line.startsWith('(cd ')) continue;
    const token = /^[A-Za-z0-9_./-]+/.exec(line.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+ )+/, ''))?.[0] ?? '';
    const name = token.split('/').at(-1) ?? '';
    if (['cp', 'rm', 'ln', 'rmdir'].includes(name)) found.add(name);
    if (line.includes(' && ')) found.add('&&');
  }
  return [...found].sort();
}
