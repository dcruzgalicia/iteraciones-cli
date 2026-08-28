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

/**
 * Validación PDF/X-1a de los PDF generados (fase final del build).
 *
 * El binario `iteraciones-pdfcheck` (crate en tools/pdfx-validator, pdf-oxide)
 * certifica un PDF contra PDF/X-1a:2001 (estricto, único nivel) y emite un
 * informe JSON. La
 * validación es opcional: se corre solo cuando el preamble filter 99-pdfx está
 * activo y, si el binario no existe, se intenta compilar con cargo; si no se
 * obtiene, se advierte sin romper el build (mismo patrón que las herramientas
 * opcionales de doctor).
 */

/** Nombre del binario de validación PDF/X-1a. */
const PDFCHECK_BIN_NAME = 'iteraciones-pdfcheck';

/** Tiempo máximo de una compilación release del binario (pdf-oxide es grande). */
const CARGO_BUILD_TIMEOUT_MS = 600_000;

/** Tiempo máximo de una validación individual (pdf-oxide valida en ms). */
const PDFCHECK_TIMEOUT_MS = 30_000;

/**
 * Directorio gestionado del binario, **compartido entre proyectos** y a salvo
 * de `clean`/`--full` (que borran `dist/` y `.iteraciones/` del proyecto):
 * `$XDG_CACHE_HOME/iteraciones/bin` o `~/.cache/iteraciones/bin`.
 */
function managedBinDir(): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
  return join(base, 'iteraciones', 'bin');
}

/**
 * Resuelve la ruta del binario sin construir: directorio gestionado (caché de
 * usuario) primero y luego PATH. Retorna null si no está.
 */
export async function resolvePdfCheckBinary(): Promise<string | null> {
  const managed = join(managedBinDir(), PDFCHECK_BIN_NAME);
  if (existsSync(managed)) return managed;
  return (await Bun.which(PDFCHECK_BIN_NAME)) ?? null;
}

/**
 * Compila el binario con cargo desde la fuente del crate (tools/pdfx-validator,
 * incluida en el paquete) y lo coloca en el directorio gestionado (caché de
 * usuario). Retorna la ruta del binario o null si no se pudo obtener (cargo
 * ausente o compilación fallida); el llamador informa cómo obtenerlo sin
 * romper el build.
 */
async function buildPdfCheckBinary(): Promise<string | null> {
  const manifest = join(import.meta.dir, '../../tools/pdfx-validator/Cargo.toml');
  if (!existsSync(manifest)) return null;
  // El primer build con PDF/X compila el validador Rust: sin este aviso el
  // usuario ve el build congelado hasta 10 minutos sin explicación (#2163).
  // stderr en tiempo real: stdout es el contrato --json y el sink diferiría
  // el mensaje hasta el resumen, cuando la espera ya pasó.
  logNotice('compilando iteraciones-pdfcheck (primer build, puede tardar varios minutos)…', 'pdfx');
  try {
    await exec('cargo', ['build', '--release', '--quiet', '--manifest-path', manifest], {
      timeoutMs: CARGO_BUILD_TIMEOUT_MS,
    });
  } catch {
    // cargo ausente (ProcessSpawnError) o compilación fallida.
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

/** Un fallo (o warning) de certificación reportado por el binario. */
interface PdfCheckIssue {
  code: string;
  message: string;
  page: number | null;
  objectId: number | null;
  clause: string | null;
}

/** Informe JSON del binario (contrato del crate tools/pdfx-validator). */
interface PdfCheckResult {
  valid: boolean;
  level: string;
  errors: PdfCheckIssue[];
  warnings: PdfCheckIssue[];
}

/** Ejecuta el binario sobre un PDF y parsea su informe JSON. */
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
  /** Línea de confirmación del resumen final en éxito (undefined si no aplica). */
  summaryLine: string | undefined;
};

/**
 * Caché de validación PDF/X (#2190): clave = hash del PDF + huella del
 * binario + lista efectiva de preamble filters desactivados. Solo se cachean
 * los resultados VÁLIDOS y SIN warnings (los fallos se revalidan siempre:
 * recompilar o corregir debe re-certificar; los warnings son aviso útil).
 */
export interface PdfxCacheHandle {
  prev: Record<string, string>;
  out: Record<string, string>;
}

/**
 * Fase final del build: valida PDF/X-1a los PDFs de la salida cuando el
 * preamble filter 99-pdfx está activo (la señal de "quiero certificar para
 * imprenta"). Sin PDFs o sin 99-pdfx no hace nada; sin binario intenta
 * compilarlo con cargo (si `allowBuild`) y, si no se obtiene, advierte sin
 * romper el build.
 *
 * Contrato de fallo (decisión D2, issue #2162): con 99-pdfx activo, un PDF
 * que no certifica hace FALLAR el build (BuildError con archivo/página/código
 * de cada PDF incumplidor). El filter activo es la señal explícita de
 * imprenta; quien no quiere bloqueo desactiva el filter. Los warnings de los
 * PDFs que sí certifican quedan en advertencias sin bloquear.
 */
export async function runPdfxOutputValidation(
  outputDir: string,
  siteConfig: SiteConfig,
  options: { allowBuild?: boolean } = {},
  /** Lista efectiva de preamble filters desactivados (issue #2022: la config del usuario no se muta). */
  effectiveDisabledPreamble?: string[],
  /** Caché de resultados (#2190): prev se consulta, out acumula los nuevos válidos. */
  cache?: PdfxCacheHandle,
): Promise<PdfxOutputValidationResult> {
  const disabled = effectiveDisabledPreamble ?? siteConfig.format?.pdf?.disabledPreambleFilters ?? [];
  if (disabled.includes('99-pdfx')) return { validated: 0, failed: 0, summaryLine: undefined };
  if (!existsSync(outputDir)) return { validated: 0, failed: 0, summaryLine: undefined };
  // Glob recursivo: los PDFs se escriben anidados por subdirectorio según la
  // ruta del documento (pipeline.ts outBase), no solo en la raíz de dist/.
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
  // Huella del binario en la clave: reconstruirlo (o actualizarlo) revalida.
  let binFp = '';
  try {
    const st = statSync(binary);
    binFp = `${Math.round(st.mtimeMs)}:${st.size}`;
  } catch {
    binFp = 'desconocido';
  }
  /** Clave de caché de un PDF: contenido + binario + configuración efectiva. */
  const cacheKeyFor = async (file: string): Promise<string> =>
    `${file}\0${await hashFileContent(join(outputDir, file)).catch(() => 'ilegible')}\0${binFp}\0${disabled.join(',')}`;
  // Los PDFs con resultado cacheado no se envían al validador (#2190)
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
  // Validación concurrente con límite prudente (#2026): saturar CPU/disco
  // degrada; la SALIDA se emite en el orden determinista del glob ordenado.
  const results = await mapWithConcurrency(pendientes, Math.min(4, Math.max(1, cpus().length)), (file) =>
    validatePdfX1a(join(outputDir, file), binary),
  );
  // Mapa resultado por PDF para emitir en el orden determinista original.
  const porFile = new Map<string, Awaited<ReturnType<typeof validatePdfX1a>>>();
  for (const [i, result] of results.entries()) {
    const file = pendientes[i];
    if (file !== undefined && result !== undefined) porFile.set(file, result);
  }
  for (const [i, file] of pdfs.entries()) {
    // Los ya cacheados solo suman: no re-validar un PDF idéntico compilado
    // con el mismo binario y configuración (#2190).
    const cachedOk = cache !== undefined && claves[i] !== '' && cache.prev[claves[i] ?? ''] === '1';
    if (cachedOk) continue; // ya contada en el pre-paso de caché (#2190)
    const result = porFile.get(file);
    validated += 1;
    const where = (iss: PdfCheckIssue): string => (iss.page !== null && iss.page !== undefined ? ` — página ${iss.page + 1}` : '');
    // Se reportan TODOS los fallos (errors ya incluyen los warnings de
    // identificación promovidos a error) y TODOS los warnings restantes, para
    // que ningún incumplimiento u advertencia quede oculto (issue #1971).
    // Los detalles de un PDF que no certifica viajan en el error (la ruta de
    // fallo del build no imprime los warnings acumulados del tracker).
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
      // Cacheable: válido y sin warnings (los warnings se re-avisan siempre)
      if (cache && result.warnings.length === 0 && claves[i] !== undefined && claves[i] !== '') {
        cache.out[claves[i] ?? ''] = '1';
      }
      for (const w of result.warnings) {
        logWarning(`${file}: advertencia PDF/X-1a — [${w.code}] ${w.message}${where(w)}`, 'pdfx');
      }
    }
  }
  // La caché nueva hereda las claves vigentes del estado previo: los PDFs que
  // siguen existiendo conservan su certificación sin re-validar (#2190).
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
  // Éxito: confirmación explícita en el resumen final (issue #1960).
  return {
    validated,
    failed,
    summaryLine: `${GLYPHS.success} Validación PDF/X-1a: ${validated} ${validated === 1 ? 'PDF certifica' : 'PDFs certifican'} PDF/X-1a`,
  };
}
