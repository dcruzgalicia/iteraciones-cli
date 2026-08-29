import { discoverBibFiles } from '../builder/state.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_PDF_FORMAT } from '../config/site-config.js';
import { GLYPHS, logInfo } from '../lib/logger.js';
import {
  type CheckResult,
  checkBiber,
  checkBunVersion,
  checkLatexEngine,
  checkMagick,
  checkPandoc,
  checkPdfCheck,
  checkPdfToPpm,
  checkReadPermissions,
  checkWritePermissions,
} from './doctor/system-checks.js';

/**
 * Ejecuta las comprobaciones de doctor y las devuelve estructuradas.
 * Comparte la lógica con doctorEnvironment (checks del entorno).
 */
export async function collectChecks(cwd: string): Promise<CheckResult[]> {
  // La config se carga una sola vez (en paralelo con las verificaciones de
  // entorno): el motor LaTeX solo se verifica si el proyecto lo necesita
  // (format.pdf o format.latex activos), mismo criterio que validate.
  const [loadedOrError, pandoc, read, write] = await Promise.all([
    loadSiteConfigIfPresent(cwd).then(
      (loaded) => ({ loaded }),
      (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
    ),
    checkPandoc(),
    checkReadPermissions(cwd),
    checkWritePermissions(cwd),
  ]);
  // Sin iteraciones.config.yaml el check falla con salida accionable; los
  // errores de parseo/validación llegan con el mensaje del loader.
  const configResult: { siteConfig: SiteConfig | null; ok: boolean; detail: string | undefined } =
    'error' in loadedOrError
      ? { siteConfig: null, ok: false, detail: loadedOrError.error }
      : loadedOrError.loaded
        ? { siteConfig: loadedOrError.loaded.config, ok: true, detail: undefined }
        : {
            siteConfig: null,
            ok: false,
            detail: "no se encontró iteraciones.config.yaml; ejecuta 'iteraciones init' para crearlo",
          };
  const needsLatex = configResult.siteConfig !== null && configResult.siteConfig.format?.pdf?.generate === true;
  // PDF/X solo interesa cuando el proyecto lo activa: pdf.generate y 99-pdfx
  // NO desactivado (#2082). El matiz importa: el schema transforma una lista
  // vacía escrita por el usuario (`disabled-preamble-filters: []`) en
  // undefined, así que la distinción ausente-vs-vacío se hace con presentKeys
  // (misma técnica del --info). Sin clave: defaults del paquete (99-pdfx off).
  const userWroteDisabledList = !('error' in loadedOrError) && loadedOrError.loaded?.presentKeys.has('format.pdf.disabled-preamble-filters') === true;
  const disabledList = configResult.siteConfig?.format?.pdf?.disabledPreambleFilters;
  const effectiveDisabled = userWroteDisabledList ? (disabledList ?? []) : (DEFAULT_PDF_FORMAT.disabledPreambleFilters ?? []);
  const needsPdfx = needsLatex && !effectiveDisabled.includes('99-pdfx');
  const latex = needsLatex ? await checkLatexEngine() : undefined;
  // La portada del PDF (pdftoppm) solo interesa a proyectos que generan PDF
  // (mismo criterio que el motor LaTeX); es un check opcional (warn).
  const pdfToPpm = needsLatex ? await checkPdfToPpm() : undefined;
  // ImageMagick (magick) para preprocesamiento de imágenes CMYK 300dpi.
  const magick = needsLatex ? await checkMagick() : undefined;
  const pdfCheck = needsPdfx ? await checkPdfCheck() : undefined;
  // biber: backend de citas de biblatex — solo cuando el proyecto genera PDF
  // y tiene bibliografía (configurada o .bib descubierto, el mismo criterio
  // con el que resolveBibOptions arma las citas) (#2184).
  const bibDiscovered =
    configResult.siteConfig?.bibliography === undefined
      ? await discoverBibFiles(cwd, ['bib']).then(
          (files) => files.length > 0,
          () => false,
        )
      : true;
  const needsBiber = needsLatex && bibDiscovered;
  const biber = needsBiber ? checkBiber() : undefined;

  return [
    checkBunVersion(),
    pandoc,
    // Binario de certificación PDF/X-1a (warn): solo cuando el proyecto activa
    // PDF/X (#2082). Sin él el build sigue funcionando, solo se omite la
    // certificación.
    ...(pdfCheck ? [pdfCheck] : []),
    { label: 'iteraciones.config.yaml', ok: configResult.ok, detail: configResult.detail },
    read,
    write,
    ...(latex ? [latex] : []),
    ...(pdfToPpm ? [pdfToPpm] : []),
    ...(magick ? [magick] : []),
    ...(biber ? [biber] : []),
  ];
}

/**
 * Verifica que el entorno tenga todo lo necesario para correr `iteraciones build`.
 */
export async function doctorEnvironment(cwd: string): Promise<void> {
  const checks = await collectChecks(cwd);

  renderChecks(checks);

  const allOk = checks.filter((c) => !c.warn).every((c) => c.ok);
  logInfo(allOk ? 'Todo en orden.' : 'Hay problemas que corregir.', 'doctor');
  if (!allOk) process.exitCode = 1;
}

/**
 * Renderiza una línea por check con ✔/✖ y el detalle del fallo (sin ANSI:
 * la salida es idéntica en TTY y non-TTY, patrón del tracker del build).
 */
function renderChecks(checks: CheckResult[]): void {
  for (const check of checks) {
    const detail = check.ok || !check.detail ? '' : ` — ${check.detail}`;
    const glyph = check.ok ? GLYPHS.success : check.warn ? GLYPHS.warning : GLYPHS.error;
    process.stdout.write(`${glyph} ${check.label}${detail}\n`);
  }
}
