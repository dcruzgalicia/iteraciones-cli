import { checkLatexEngine, checkMagick, checkPdfToPpm } from '../../cli/doctor/system-checks.js';
import { getPandocVersion } from '../../lib/pandoc-runner.js';

/**
 * #2549 — capabilities del entorno, para el gating de Gherkin.
 *
 * Los detectores NO son nuevos: se reusan los de producción (`checkMagick`,
 * `checkLatexEngine`, `checkPdfToPpm`) y `getPandocVersion`,
 * que es lo que usaba la suite de `bun:test` con `describe.skipIf`.
 * Duplicarlos haría que el doctor dijera una cosa y el gating otra, y la
 * cobertura se perdería en silencio justo cuando el entorno está roto — que es
 * cuando más importa.
 *
 * `unzip`, `pdftotext` y `pdftoppm` no usan un detector del doctor (no son
 * parte de él, o el doctor los agrupa); se comprueban con un spawn mínimo.
 *
 * ## El nombre del tag y el nombre de la capability son la misma cosa
 *
 * `@requires-pandoc` ↔ clave `pandoc`. Una sola tabla, para que no pueda
 * existir un tag que no mapea a nada.
 */

export const SKIP_REASONS = {
  pandoc: 'requiere pandoc',
  magick: 'requiere ImageMagick',
  latex: 'requiere motor LaTeX (latexmk)',
  unzip: 'requiere unzip',
  pdftotext: 'requiere pdftotext (poppler)',
  pdftoppm: 'requiere pdftoppm (poppler)',
  // La paridad con `git check-ignore` necesita un git de verdad contra el que
  // comparar. Sin él, esa suite no se puede correr y no hay substitute que
  // sirva: reimplementar git sería el doble que se está tratando de evitar.
  git: 'requiere git',
} as const;

export type Capability = keyof typeof SKIP_REASONS;

export const CAPABILITIES = Object.keys(SKIP_REASONS) as Capability[];

/** El prefijo de los tags que el gating entiende. */
export const TAG_PREFIX = 'requires-';

async function existe(bin: string, args: string[]): Promise<boolean> {
  return Bun.spawn([bin, ...args], { stdout: 'ignore', stderr: 'ignore' })
    .exited.then((code) => code === 0)
    .catch(() => false);
}

type Detector = () => Promise<boolean>;

/**
 * `forced` permite simular una máquina a la que le falta algo. Es lo que hace
 * testeable el requisito del issue — "la lista de omitidos en una máquina sin
 * pandoc es la misma que da `describe.skipIf` hoy" — sin tener que desinstalar
 * pandoc. Sólo lo usa el test del gating.
 */
const DETECTORS: Record<Capability, Detector> = {
  pandoc: async () => (await getPandocVersion().catch(() => null)) !== null,
  magick: async () => (await checkMagick()).ok,
  latex: async () => (await checkLatexEngine()).ok,
  unzip: () => existe('unzip', ['-v']),
  pdftotext: () => existe('pdftotext', ['-v']),
  pdftoppm: async () => (await checkPdfToPpm()).ok,
  git: () => existe('git', ['--version']),
};

export async function detectCapabilities(forced?: Partial<Record<Capability, boolean>>): Promise<Record<Capability, boolean>> {
  const result = {} as Record<Capability, boolean>;
  await Promise.all(
    CAPABILITIES.map(async (capability) => {
      result[capability] = forced?.[capability] ?? (await DETECTORS[capability]());
    }),
  );
  return result;
}
