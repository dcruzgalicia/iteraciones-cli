import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/site-config.js';
import { ConfigError } from '../lib/errors.js';
import { logInfo, logWarning } from '../lib/logger.js';
import { type CheckResult, checkLatexEngine, checkPandoc, checkReadPermissions, checkWritePermissions } from './doctor/system-checks.js';

/**
 * Verifica que el entorno tenga todo lo necesario para correr `iteraciones build`.
 * Con `options.fix = true` intenta corregir automáticamente los problemas reparables.
 */
export async function runDoctor(cwd: string, options: { fix?: boolean } = {}): Promise<void> {
  // La config se carga una sola vez (en paralelo con las verificaciones de
  // entorno): el motor LaTeX solo se verifica si el proyecto lo necesita
  // (format.pdf o format.latex activos), mismo criterio que validate.
  const [configResult, pandoc, read, write] = await Promise.all([
    loadSiteConfig(cwd).then(
      (siteConfig: SiteConfig) => ({ siteConfig, ok: true, detail: undefined as string | undefined }),
      (err: unknown) => ({
        siteConfig: null,
        ok: false,
        detail: err instanceof ConfigError ? err.message : err instanceof Error ? err.message : String(err),
      }),
    ),
    checkPandoc(),
    checkReadPermissions(cwd),
    checkWritePermissions(cwd),
  ]);
  const needsLatex =
    configResult.siteConfig !== null && (configResult.siteConfig.format?.pdf?.generate === true || configResult.siteConfig.format?.latex === true);
  const latex = needsLatex ? await checkLatexEngine() : undefined;

  const checks: CheckResult[] = [
    pandoc,
    { label: 'iteraciones.config.yaml', ok: configResult.ok, detail: configResult.detail },
    read,
    write,
    ...(latex ? [latex] : []),
  ];

  renderChecks(checks);

  if (!options.fix) {
    const allOk = checks.every((c) => c.ok);
    logInfo(allOk ? 'Todo en orden.' : 'Hay problemas que corregir.', 'doctor');
    if (!allOk) process.exitCode = 1;
    return;
  }

  // Modo --fix: corregir los problemas reparables y reportar lo restante
  const fixable = checks.filter((c): c is CheckResult & { fixAction: () => Promise<string> } => !c.ok && c.fixAction != null);
  let fixFailed = false;
  for (const check of fixable) {
    try {
      const detail = await check.fixAction();
      const suffix = detail ? ` — ${detail}` : '';
      process.stdout.write(`✔ ${check.label} (corregido)${suffix}\n`);
    } catch (err) {
      fixFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`✖ ${check.label} (corrección falló — ${message})\n`);
    }
  }

  const unfixable = checks.filter((c) => !c.ok && c.fixAction == null);
  const stillBroken = unfixable.length > 0 || fixFailed;

  if (!stillBroken && fixable.length > 0) {
    logInfo('Correcciones aplicadas. Ejecuta doctor de nuevo para verificar.', 'doctor');
  } else if (stillBroken) {
    logWarning(fixable.length > 0 ? 'Hay problemas sin correccion automatica disponible.' : 'Hay problemas que corregir.', 'doctor');
  } else {
    logInfo('Todo en orden.', 'doctor');
  }

  if (stillBroken) process.exitCode = 1;
}

/**
 * Renderiza una línea por check con ✔/✖ y el detalle del fallo (sin ANSI:
 * la salida es idéntica en TTY y non-TTY, patrón del tracker del build).
 */
function renderChecks(checks: CheckResult[]): void {
  for (const check of checks) {
    const detail = check.ok || !check.detail ? '' : ` — ${check.detail}`;
    process.stdout.write(`${check.ok ? '✔' : '✖'} ${check.label}${detail}\n`);
  }
}
