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

  let binary = await resolvePdfCheckBinary();
  if (!binary && options.allowBuild) binary = await buildPdfCheckBinary();
  if (!binary) {
    logWarning(
      'el binario de validación PDF/X-1a no está disponible y no se pudo compilar (instala Rust con rustup: https://doc.rust-lang.org/book/ch01-01-installation.html, o descarga el precompilado): los PDF no se validaron',
      'pdfx',
    );
    return { validated: 0, failed: 0, summaryLine: undefined };
  }

  let validated = 0;
  let failed = 0;
  const fallos: string[] = [];
  let binFp = '';
  try {
    const st = statSync(binary);
    binFp = `${Math.round(st.mtimeMs)}:${st.size}`;
  } catch {
    binFp = 'desconocido';
  }
  const cacheKeyFor = async (file: string): Promise<string> =>
    `${file}\0${await hashFileContent(join(outputDir, file)).catch(() => 'ilegible')}\0${binFp}\0${disabled.join(',')}`;
  const pendientes: string[] = [];
  const claves: string[] = [];
  if (cache) {
    for (const file of pdfs) {
      const key = await cacheKeyFor(file);
      claves.push(key);
      if (cache.prev[key] === '1') validated++;
      else pendientes.push(file);
    }
  } else {
    pendientes.push(...pdfs);
    claves.push(...pdfs.map(() => ''));
  }
  const results = await mapWithConcurrency(pendientes, Math.min(4, Math.max(1, cpus().length)), (file) =>
    validatePdfX1a(join(outputDir, file), binary),
  );
  const porFile = new Map<string, Awaited<ReturnType<typeof validatePdfX1a>>>();
  for (const [i, result] of results.entries()) {
    const file = pendientes[i];
    if (file !== undefined && result !== undefined) porFile.set(file, result);
  }
  for (const [i, file] of pdfs.entries()) {
    const cachedOk = cache !== undefined && claves[i] !== '' && cache.prev[claves[i] ?? ''] === '1';
    if (cachedOk) continue; // ya contada en el pre-paso de caché (#2190)
    const result = porFile.get(file);
    validated += 1;
    const where = (iss: PdfCheckIssue): string => (iss.page !== null && iss.page !== undefined ? ` — página ${iss.page + 1}` : '');
    if (result === undefined) {
      fallos.push(`${file}: sin resultado del validador`);
      continue;
    }
    if (!result.valid) {
      failed += 1;
      fallos.push(`${file}: no cumple PDF/X-1a (${plural(result.errors.length, 'fallo', 'fallos')})`);
      for (const e of result.errors) {
        fallos.push(`  [${e.code}] ${e.message}${where(e)}`);
      }
      for (const w of result.warnings) {
        fallos.push(`  advertencia — [${w.code}] ${w.message}${where(w)}`);
      }
    } else {
      if (cache && result.warnings.length === 0 && claves[i] !== undefined && claves[i] !== '') {
        cache.out[claves[i] ?? ''] = '1';
      }
      for (const w of result.warnings) {
        logWarning(`${file}: advertencia PDF/X-1a — [${w.code}] ${w.message}${where(w)}`, 'pdfx');
      }
    }
  }
  if (cache) {
    const vigentes = new Set(claves.filter((k) => k !== ''));
    for (const key of Object.keys(cache.prev)) {
      const prev = cache.prev[key];
      if (prev !== undefined && vigentes.has(key) && cache.out[key] === undefined) cache.out[key] = prev;
    }
  }
  if (failed > 0) {
    throw new BuildError(`${failed} de ${validated} PDFs no certifican PDF/X-1a.\n${fallos.map((l) => `  ${l}`).join('\n')}`);
  }
  return {
    validated,
    failed,
    summaryLine: `${GLYPHS.success} Validación PDF/X-1a: ${validated} ${validated === 1 ? 'PDF certifica' : 'PDFs certifican'} PDF/X-1a`,
  };
}
