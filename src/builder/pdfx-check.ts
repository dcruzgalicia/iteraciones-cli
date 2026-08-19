import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { run } from '../lib/run.js';

/**
 * Validación PDF/X-1a de los PDF generados (fase final del build).
 *
 * El binario `iteraciones-pdfcheck` (crate en tools/pdfx-validator, pdf-oxide)
 * certifica un PDF contra PDF/X-1a:2001 y :2003 y emite un informe JSON. La
 * validación es opcional: se corre solo cuando el preamble filter 99-pdfx está
 * activo y, si el binario no existe, se intenta compilar con cargo; si no se
 * obtiene, se advierte sin romper el build (mismo patrón que las herramientas
 * opcionales de doctor).
 */

/** Nombre del binario de validación PDF/X-1a. */
export const PDFCHECK_BIN_NAME = 'iteraciones-pdfcheck';

/** Tiempo máximo de una compilación release del binario (pdf-oxide es grande). */
const CARGO_BUILD_TIMEOUT_MS = 600_000;

/** Tiempo máximo de una validación individual (pdf-oxide valida en ms). */
const PDFCHECK_TIMEOUT_MS = 30_000;

/** Directorio gestionado del binario: <proyecto>/.iteraciones/bin/. */
function managedBinDir(cwd: string): string {
  return join(cwd, '.iteraciones', 'bin');
}

/**
 * Resuelve la ruta del binario sin construir: directorio gestionado
 * (<proyecto>/.iteraciones/bin/) primero y luego PATH. Retorna null si no está.
 */
export async function resolvePdfCheckBinary(cwd: string): Promise<string | null> {
  const managed = join(managedBinDir(cwd), PDFCHECK_BIN_NAME);
  if (existsSync(managed)) return managed;
  return (await Bun.which(PDFCHECK_BIN_NAME)) ?? null;
}

/**
 * Compila el binario con cargo desde la fuente del crate (tools/pdfx-validator,
 * incluida en el paquete) y lo coloca en el directorio gestionado. Retorna la
 * ruta del binario o null si no se pudo obtener (cargo ausente o compilación
 * fallida); el llamador informa cómo obtenerlo sin romper el build.
 */
export async function buildPdfCheckBinary(cwd: string): Promise<string | null> {
  const manifest = join(import.meta.dir, '../../tools/pdfx-validator/Cargo.toml');
  if (!existsSync(manifest)) return null;
  try {
    await run('cargo', ['build', '--release', '--quiet', '--manifest-path', manifest], {
      timeoutMs: CARGO_BUILD_TIMEOUT_MS,
    });
  } catch {
    // cargo ausente (ProcessSpawnError) o compilación fallida.
    return null;
  }
  const built = join(dirname(manifest), 'target', 'release', PDFCHECK_BIN_NAME);
  if (!existsSync(built)) return null;
  const destDir = managedBinDir(cwd);
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, PDFCHECK_BIN_NAME);
  await copyFile(built, dest);
  await chmod(dest, 0o755);
  return dest;
}

/** Un fallo (o warning) de certificación reportado por el binario. */
export interface PdfCheckIssue {
  code: string;
  message: string;
  page: number | null;
  objectId: number | null;
  clause: string | null;
}

/** Informe JSON del binario (contrato del crate tools/pdfx-validator). */
export interface PdfCheckResult {
  valid: boolean;
  level: string;
  errors: PdfCheckIssue[];
  warnings: PdfCheckIssue[];
}

/** Ejecuta el binario sobre un PDF y parsea su informe JSON. */
export async function validatePdfX1a(pdfPath: string, binaryPath: string): Promise<PdfCheckResult> {
  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run(binaryPath, [pdfPath], { timeoutMs: PDFCHECK_TIMEOUT_MS });
  } catch (err) {
    return {
      valid: false,
      level: 'PDF/X-1a',
      errors: [
        {
          code: 'PDFCHECK_RUN',
          message: err instanceof Error ? err.message : String(err),
          page: null,
          objectId: null,
          clause: null,
        },
      ],
      warnings: [],
    };
  }
  try {
    return JSON.parse(result.stdout) as PdfCheckResult;
  } catch {
    return {
      valid: false,
      level: 'PDF/X-1a',
      errors: [
        {
          code: 'PDFCHECK_OUTPUT',
          message: `salida inesperada del binario: ${result.stderr.trim() || result.stdout.trim()}`,
          page: null,
          objectId: null,
          clause: null,
        },
      ],
      warnings: [],
    };
  }
}

export type PdfxOutputValidationResult = { validated: number; failed: number };

/**
 * Fase final del build: valida PDF/X-1a los PDFs de la salida cuando el
 * preamble filter 99-pdfx está activo (la señal de "quiero certificar para
 * imprenta"). Sin PDFs o sin 99-pdfx no hace nada; sin binario intenta
 * compilarlo con cargo (si `allowBuild`) y, si no se obtiene, advierte sin
 * romper el build.
 */
export async function runPdfxOutputValidation(
  cwd: string,
  outputDir: string,
  siteConfig: SiteConfig,
  options: { allowBuild?: boolean } = {},
): Promise<PdfxOutputValidationResult> {
  const disabled = siteConfig.format?.pdf?.disabledPreambleFilters ?? [];
  if (disabled.includes('99-pdfx')) return { validated: 0, failed: 0 };
  if (!existsSync(outputDir)) return { validated: 0, failed: 0 };
  const pdfs = [...new Bun.Glob('*.pdf').scanSync({ cwd: outputDir, onlyFiles: true })].sort();
  if (pdfs.length === 0) return { validated: 0, failed: 0 };

  let binary = await resolvePdfCheckBinary(cwd);
  if (!binary && options.allowBuild) binary = await buildPdfCheckBinary(cwd);
  if (!binary) {
    logWarning(
      'el binario de validación PDF/X-1a no está disponible y no se pudo compilar (instala Rust con rustup: https://doc.rust-lang.org/book/ch01-01-installation.html, o descarga el precompilado): los PDF no se validaron',
      'pdfx',
    );
    return { validated: 0, failed: 0 };
  }

  let validated = 0;
  let failed = 0;
  for (const file of pdfs) {
    const result = await validatePdfX1a(join(outputDir, file), binary);
    validated += 1;
    if (!result.valid) {
      failed += 1;
      const first = result.errors[0];
      let where = '';
      if (first && first.page !== null && first.page !== undefined) {
        where = ` — página ${first.page + 1}`;
      }
      logWarning(
        `${file}: no cumple PDF/X-1a (${plural(result.errors.length, 'fallo', 'fallos')}${
          first ? `, primero [${first.code}] ${first.message}${where}` : ''
        })`,
        'pdfx',
      );
    }
  }
  if (failed > 0) {
    logWarning(`${failed} de ${validated} PDFs no certifican PDF/X-1a.`, 'pdfx');
  }
  return { validated, failed };
}
