import { existsSync, statSync } from 'node:fs';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { cpus, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { BuildError } from '../lib/errors.js';
import { GLYPHS, logNotice, logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { exec, mapWithConcurrency } from '../lib/run.js';
import { hashFileContent } from './state-serialize.js';

const PDFCHECK_BIN_NAME = 'iteraciones-pdfcheck';

const CARGO_BUILD_TIMEOUT_MS = 600_000;

const PDFCHECK_TIMEOUT_MS = 30_000;

function managedBinDir(): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
  return join(base, 'iteraciones', 'bin');
}

export async function resolvePdfCheckBinary(): Promise<string | null> {
  const managed = join(managedBinDir(), PDFCHECK_BIN_NAME);
  if (existsSync(managed)) return managed;
  return (await Bun.which(PDFCHECK_BIN_NAME)) ?? null;
}

async function buildPdfCheckBinary(): Promise<string | null> {
  const manifest = join(import.meta.dir, '../../tools/pdfx-validator/Cargo.toml');
  if (!existsSync(manifest)) return null;
  logNotice('compilando iteraciones-pdfcheck (primer build, puede tardar varios minutos)…', 'pdfx');
  try {
    await exec('cargo', ['build', '--release', '--quiet', '--manifest-path', manifest], {
      timeoutMs: CARGO_BUILD_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  const built = join(dirname(manifest), 'target', 'release', PDFCHECK_BIN_NAME);
  if (!existsSync(built)) return null;
  const destDir = managedBinDir();
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, PDFCHECK_BIN_NAME);
  await copyFile(built, dest);
  await chmod(dest, 0o755);
  return dest;
}

interface PdfCheckIssue {
  code: string;
  message: string;
  page: number | null;
  objectId: number | null;
  clause: string | null;
}

interface PdfCheckResult {
  valid: boolean;
  level: string;
  errors: PdfCheckIssue[];
  warnings: PdfCheckIssue[];
}

export async function validatePdfX1a(pdfPath: string, binaryPath: string): Promise<PdfCheckResult> {
  let result: Awaited<ReturnType<typeof exec>>;
  try {
    result = await exec(binaryPath, [pdfPath], { timeoutMs: PDFCHECK_TIMEOUT_MS });
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

type PdfxOutputValidationResult = {
  validated: number;
  failed: number;
  summaryLine: string | undefined;
};

export interface PdfxCacheHandle {
  prev: Record<string, string>;
  out: Record<string, string>;
}

async function resolveBinary(options: { allowBuild?: boolean }): Promise<string | null> {
  let binary = await resolvePdfCheckBinary();
  if (!binary && options.allowBuild) binary = await buildPdfCheckBinary();
  if (!binary) {
    logWarning(
      'el binario de validación PDF/X-1a no está disponible y no se pudo compilar (instala Rust con rustup: https://doc.rust-lang.org/book/ch01-01-installation.html, o descarga el precompilado): los PDF no se validaron',
      'pdfx',
    );
  }
  return binary;
}

function getBinFingerprint(binary: string): string {
  try {
    const st = statSync(binary);
    return `${Math.round(st.mtimeMs)}:${st.size}`;
  } catch {
    return 'desconocido';
  }
}

function buildCacheKeys(
  pdfs: string[],
  outputDir: string,
  binFp: string,
  disabled: string[],
  cache?: PdfxCacheHandle,
): Promise<{ pendientes: string[]; claves: string[]; preValidated: number }> {
  const cacheKeyFor = async (file: string): Promise<string> =>
    `${file}\0${await hashFileContent(join(outputDir, file)).catch(() => 'ilegible')}\0${binFp}\0${disabled.join(',')}`;
  const pendientes: string[] = [];
  const claves: string[] = [];
  let preValidated = 0;
  if (cache) {
    return (async () => {
      for (const file of pdfs) {
        const key = await cacheKeyFor(file);
        claves.push(key);
        if (cache.prev[key] === '1') preValidated++;
        else pendientes.push(file);
      }
      return { pendientes, claves, preValidated };
    })();
  }
  return Promise.resolve({ pendientes: [...pdfs], claves: pdfs.map(() => ''), preValidated: 0 });
}

function processResult(
  file: string,
  result: PdfCheckResult | undefined,
  claves: string[],
  i: number,
  cache?: PdfxCacheHandle,
): { validated: boolean; failed: boolean; falloLines: string[] } {
  const where = (iss: PdfCheckIssue): string => (iss.page !== null && iss.page !== undefined ? ` — página ${iss.page + 1}` : '');
  if (result === undefined) {
    return { validated: true, failed: false, falloLines: [`${file}: sin resultado del validador`] };
  }
  if (!result.valid) {
    const lines = [`${file}: no cumple PDF/X-1a (${plural(result.errors.length, 'fallo', 'fallos')})`];
    for (const e of result.errors) lines.push(`  [${e.code}] ${e.message}${where(e)}`);
    for (const w of result.warnings) lines.push(`  advertencia — [${w.code}] ${w.message}${where(w)}`);
    return { validated: true, failed: true, falloLines: lines };
  }
  if (cache && result.warnings.length === 0 && claves[i] !== undefined && claves[i] !== '') {
    cache.out[claves[i] ?? ''] = '1';
  }
  for (const w of result.warnings) {
    logWarning(`${file}: advertencia PDF/X-1a — [${w.code}] ${w.message}${where(w)}`, 'pdfx');
  }
  return { validated: true, failed: false, falloLines: [] };
}

function finalizeCache(cache: PdfxCacheHandle, claves: string[]): void {
  const vigentes = new Set(claves.filter((k) => k !== ''));
  for (const key of Object.keys(cache.prev)) {
    const prev = cache.prev[key];
    if (prev !== undefined && vigentes.has(key) && cache.out[key] === undefined) cache.out[key] = prev;
  }
}

function isCached(claves: string[], i: number, cache?: PdfxCacheHandle): boolean {
  return cache !== undefined && claves[i] !== '' && cache.prev[claves[i] ?? ''] === '1';
}

function mapResultsToFiles(
  pendientes: string[],
  results: Awaited<ReturnType<typeof validatePdfX1a>>[],
): Map<string, Awaited<ReturnType<typeof validatePdfX1a>>> {
  const porFile = new Map<string, Awaited<ReturnType<typeof validatePdfX1a>>>();
  for (const [i, result] of results.entries()) {
    const file = pendientes[i];
    if (file !== undefined && result !== undefined) porFile.set(file, result);
  }
  return porFile;
}

export async function runPdfxOutputValidation(
  outputDir: string,
  siteConfig: SiteConfig,
  options: { allowBuild?: boolean } = {},
  effectiveDisabledPreamble?: string[],
  cache?: PdfxCacheHandle,
): Promise<PdfxOutputValidationResult> {
  const disabled = effectiveDisabledPreamble ?? siteConfig.format?.pdf?.disabledPreambleFilters ?? [];
  if (disabled.includes('99-pdfx')) return { validated: 0, failed: 0, summaryLine: undefined };
  if (!existsSync(outputDir)) return { validated: 0, failed: 0, summaryLine: undefined };
  const pdfs = [...new Bun.Glob('**/*.pdf').scanSync({ cwd: outputDir, onlyFiles: true })].sort();
  if (pdfs.length === 0) return { validated: 0, failed: 0, summaryLine: undefined };

  const binary = await resolveBinary(options);
  if (!binary) return { validated: 0, failed: 0, summaryLine: undefined };

  const binFp = getBinFingerprint(binary);
  const { pendientes, claves, preValidated } = await buildCacheKeys(pdfs, outputDir, binFp, disabled, cache);
  const results = await mapWithConcurrency(pendientes, Math.min(4, Math.max(1, cpus().length)), (file) =>
    validatePdfX1a(join(outputDir, file), binary),
  );
  const porFile = mapResultsToFiles(pendientes, results);

  let validated = preValidated;
  let failed = 0;
  const fallos: string[] = [];
  for (const [i, file] of pdfs.entries()) {
    if (isCached(claves, i, cache)) continue;
    const result = porFile.get(file);
    const { validated: wasValidated, failed: wasFailed, falloLines } = processResult(file, result, claves, i, cache);
    if (wasValidated) validated++;
    if (wasFailed) failed++;
    fallos.push(...falloLines);
  }
  if (cache) finalizeCache(cache, claves);
  if (failed > 0) {
    throw new BuildError(`${failed} de ${validated} PDFs no certifican PDF/X-1a.\n${fallos.map((l) => `  ${l}`).join('\n')}`);
  }
  return {
    validated,
    failed,
    summaryLine: `${GLYPHS.success} Validación PDF/X-1a: ${validated} ${validated === 1 ? 'PDF certifica' : 'PDFs certifican'} PDF/X-1a`,
  };
}
