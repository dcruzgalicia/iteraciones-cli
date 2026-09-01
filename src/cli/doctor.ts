import { discoverBibFiles } from '../builder/state-bib.js';
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

function resolveConfigResult(loadedOrError: {
  loaded?: ReturnType<typeof loadSiteConfigIfPresent> extends Promise<infer R> ? R : never;
  error?: string;
}) {
  if ('error' in loadedOrError) return { siteConfig: null, ok: false, detail: loadedOrError.error } as const;
  if (loadedOrError.loaded) return { siteConfig: loadedOrError.loaded.config, ok: true, detail: undefined } as const;
  return { siteConfig: null, ok: false, detail: "no se encontró iteraciones.config.yaml; ejecuta 'iteraciones init' para crearlo" } as const;
}

function resolveEffectiveDisabled(
  loadedOrError: { loaded?: { presentKeys: ReadonlySet<string> } | null; error?: string },
  siteConfig: SiteConfig | null,
): string[] {
  const userWroteDisabledList = !('error' in loadedOrError) && loadedOrError.loaded?.presentKeys.has('format.pdf.disabled-preamble-filters') === true;
  return userWroteDisabledList ? (siteConfig?.format?.pdf?.disabledPreambleFilters ?? []) : (DEFAULT_PDF_FORMAT.disabledPreambleFilters ?? []);
}

export async function collectChecks(cwd: string): Promise<CheckResult[]> {
  const [loadedOrError, pandoc, read, write] = await Promise.all([
    loadSiteConfigIfPresent(cwd).then(
      (loaded) => ({ loaded }),
      (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
    ),
    checkPandoc(),
    checkReadPermissions(cwd),
    checkWritePermissions(cwd),
  ]);
  const configResult = resolveConfigResult(loadedOrError);
  const needsLatex = configResult.siteConfig?.format?.pdf?.generate === true;
  const effectiveDisabled = resolveEffectiveDisabled(loadedOrError, configResult.siteConfig);
  const needsPdfx = needsLatex && !effectiveDisabled.includes('99-pdfx');
  const [latex, pdfToPpm, magick] = needsLatex
    ? await Promise.all([checkLatexEngine(), checkPdfToPpm(), checkMagick()])
    : [undefined, undefined, undefined];
  const pdfCheck = needsPdfx ? await checkPdfCheck() : undefined;
  const bibDiscovered =
    configResult.siteConfig?.bibliography === undefined
      ? await discoverBibFiles(cwd, ['bib']).then(
          (files) => files.length > 0,
          () => false,
        )
      : true;
  const biber = needsLatex && bibDiscovered ? checkBiber() : undefined;

  return [
    checkBunVersion(),
    pandoc,
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

export async function doctorEnvironment(cwd: string): Promise<void> {
  const checks = await collectChecks(cwd);

  renderChecks(checks);

  const allOk = checks.filter((c) => !c.warn).every((c) => c.ok);
  logInfo(allOk ? 'Todo en orden.' : 'Hay problemas que corregir.', 'doctor');
  if (!allOk) process.exitCode = 1;
}

function renderChecks(checks: CheckResult[]): void {
  for (const check of checks) {
    const detail = check.ok || !check.detail ? '' : ` — ${check.detail}`;
    const glyph = check.ok ? GLYPHS.success : check.warn ? GLYPHS.warning : GLYPHS.error;
    process.stdout.write(`${glyph} ${check.label}${detail}\n`);
  }
}
