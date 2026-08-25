import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Crea un proyecto mínimo para tests CLI: un iteraciones.config.yaml
 * y un documento Markdown con frontmatter.
 */
export async function initTestProject(dir: string): Promise<void> {
  await writeFile(
    join(dir, 'iteraciones.config.yaml'),
    ['language: es-MX', 'format:', '  html:', '    site:', '      title: Test', '    generate: true'].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'test.md'), '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n', 'utf8');
}

/**
 * Crea un directorio temporal y ejecuta la función de test. Lo limpia al final.
 * Única implementación de la infraestructura de directorios temporales de la
 * suite (antes se reimplementaba con variaciones en ~9 archivos).
 */
export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-cli-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── Reporting de skips por entorno (#2030) ──────────────────────────────────

/**
 * Razones tipadas de omisión. La suite nunca falla por entorno ausente
 * (decisión D3 del issue: los smokes reales son verificación local pre-push),
 * pero TODA corrida informa qué quedó sin verificar y por qué.
 */
export const SKIP_REASONS = {
  pandoc: 'requiere pandoc',
  latex: 'requiere motor LaTeX (latexmk)',
  unzip: 'requiere unzip',
} as const;

export type SkipReasonKey = keyof typeof SKIP_REASONS;

export type SkipReasonLabel = (typeof SKIP_REASONS)[SkipReasonKey];

/** archivo → conjunto de razones por las que se omitieron bloques. */
const skipRegistry = new Map<string, Set<string>>();

/** Registra que `file` omite bloques porque falta la capability dada. */
export function registerSkip(file: string, reason: SkipReasonLabel): void {
  const set = skipRegistry.get(file) ?? new Set<string>();
  if (!set.has(reason)) {
    set.add(reason);
    skipRegistry.set(file, set);
  }
}

/** Formatea el informe agregado de skips (puro, testeable). */
export function formatSkipReport(registry: Map<string, Set<string>> = skipRegistry): string {
  if (registry.size === 0) return '';
  const byReason = new Map<string, string[]>();
  for (const [file, reasons] of registry) {
    for (const label of reasons) {
      byReason.set(label, [...(byReason.get(label) ?? []), file]);
    }
  }
  const lines = [...byReason.entries()].map(([label, files]) => `  ${label}: ${files.join(', ')}`);
  return [`⚠ [suite] bloques omitidos por entorno — lo NO verificado en esta máquina:`, ...lines].join('\n');
}

// Informe único al finalizar el proceso: visible en toda corrida con skips,
// silencioso cuando el entorno está completo.
process.once('exit', () => {
  const report = formatSkipReport();
  if (report !== '') process.stderr.write(`\n${report}\n`);
});
