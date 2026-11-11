import { discoverBibFiles } from '../builder/state-bib.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { resolveDisabledPreambleConfig } from '../config/site-config.js';
import { GLYPHS, logInfo } from '../lib/logger.js';
import { checkMinify } from '../lib/minify.js';
import {
  type CheckResult,
  checkBiber,
  checkBunVersion,
  checkHtmlBrowser,
  checkLatexEngine,
  checkMagick,
  checkPandoc,
  checkPdfCheck,
  checkPdfToPpm,
  checkPdfToText,
  checkReadPermissions,
  checkWritePermissions,
} from './doctor/system-checks.js';

function resolveConfigResult(loadedOrError: { loaded?: Awaited<ReturnType<typeof loadSiteConfigIfPresent>>; error?: string }) {
  if ('error' in loadedOrError) return { siteConfig: null, ok: false, detail: loadedOrError.error, missing: false } as const;
  if (loadedOrError.loaded) return { siteConfig: loadedOrError.loaded.config, ok: true, detail: undefined, missing: false } as const;
  return { siteConfig: null, ok: true, detail: undefined, missing: true } as const;
}

export function checksOk(checks: CheckResult[]): boolean {
  return checks.filter((c) => !c.warn).every((c) => c.ok);
}

export async function collectChecks(cwd: string): Promise<CheckResult[]> {
  const [loadedOrError, pandoc, read, write, minify, magick] = await Promise.all([
    loadSiteConfigIfPresent(cwd).then(
      (loaded) => ({ loaded }),
      (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
    ),
    checkPandoc(),
    checkReadPermissions(cwd),
    checkWritePermissions(cwd),
    checkMinify(),
    checkMagick(),
  ]);
  const configResult = resolveConfigResult(loadedOrError);
  const needsLatex = configResult.siteConfig?.format?.pdf?.generate === true;
  const effectiveDisabled = resolveDisabledPreambleConfig(configResult.siteConfig ?? {});
  const needsPdfx = needsLatex && !effectiveDisabled.includes('99-pdfx');
  const [latex, pdfToPpm, pdfToText] = needsLatex
    ? await Promise.all([checkLatexEngine(), checkPdfToPpm(), checkPdfToText()])
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
  const navegador = await checkHtmlBrowser();

  return [
    checkBunVersion(),
    pandoc,
    minify,
    ...(pdfCheck ? [pdfCheck] : []),
    {
      label: configResult.missing ? 'iteraciones.config.yaml (opcional)' : 'iteraciones.config.yaml',
      ok: configResult.ok,
      detail: configResult.detail,
    },
    read,
    write,
    ...(latex ? [latex] : []),
    ...(pdfToPpm ? [pdfToPpm] : []),
    ...(pdfToText ? [pdfToText] : []),
    magick,
    ...(biber ? [biber] : []),
    navegador,
  ];
}

export async function doctorEnvironment(cwd: string): Promise<void> {
  const checks = await collectChecks(cwd);

  renderChecks(checks);

  const allOk = checksOk(checks);
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
