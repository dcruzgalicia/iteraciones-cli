import { Listr } from 'listr2';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/site-config.js';
import { ConfigError } from '../lib/errors.js';
import { logInfo, logWarning } from '../lib/logger.js';
import {
  type CheckResult,
  checkLatexEngine,
  checkPandoc,
  checkReadPermissions,
  checkTailwind,
  checkWritePermissions,
} from './doctor/system-checks.js';

/**
 * Verifica que el entorno tenga todo lo necesario para correr `iteraciones build`.
 * Con `options.fix = true` intenta corregir automáticamente los problemas reparables.
 */
export async function runDoctor(cwd: string, options: { fix?: boolean } = {}): Promise<void> {
  // La config se carga una sola vez (en paralelo con las verificaciones de
  // entorno): el motor LaTeX solo se verifica si el proyecto lo necesita
  // (format.pdf o format.latex activos), mismo criterio que validate.
  const [configResult, pandoc, tailwind, read, write] = await Promise.all([
    loadSiteConfig(cwd).then(
      (siteConfig: SiteConfig) => ({ siteConfig, ok: true, detail: undefined as string | undefined }),
      (err: unknown) => ({
        siteConfig: null,
        ok: false,
        detail: err instanceof ConfigError ? err.message : err instanceof Error ? err.message : String(err),
      }),
    ),
    checkPandoc(),
    checkTailwind(cwd),
    checkReadPermissions(cwd),
    checkWritePermissions(cwd),
  ]);
  const needsLatex =
    configResult.siteConfig !== null && (configResult.siteConfig.format?.pdf?.generate === true || configResult.siteConfig.format?.latex === true);
  const latex = needsLatex ? await checkLatexEngine() : undefined;

  const checks: CheckResult[] = [
    pandoc,
    { label: 'iteraciones.config.yaml', ok: configResult.ok, detail: configResult.detail },
    tailwind,
    read,
    write,
    ...(latex ? [latex] : []),
  ];

  const allOk = checks.every((c) => c.ok);

  if (!options.fix) {
    // Modo solo verificación: usar listr2 para output consistente
    const tasks = checks.map((c) => ({
      title: c.label,
      task: () => {
        if (!c.ok) throw new Error(c.detail ?? 'falló');
      },
    }));

    const listr = new Listr(tasks, { renderer: 'default', rendererOptions: { clearOutput: false, collapseSubtasks: false } });
    try {
      await listr.run();
    } catch {
      // listr2 ya muestra los errores; solo marcar exit code
    }

    logInfo(allOk ? 'Todo en orden.' : 'Hay problemas que corregir.', 'doctor');
    if (!allOk) process.exitCode = 1;
    return;
  }

  // Modo --fix: ejecutar verificaciones y luego correcciones
  const fixable = checks.filter((c): c is CheckResult & { fixAction: () => Promise<string> } => !c.ok && c.fixAction != null);

  const tasks = [
    ...checks.map((c) => ({
      title: c.label,
      task: () => {
        if (!c.ok) throw new Error(c.detail ?? 'falló');
      },
    })),
    ...fixable.map((c) => ({
      title: `${c.label} (corregir)`,
      task: async () => {
        await c.fixAction();
      },
    })),
  ];

  const listr = new Listr(tasks, { renderer: 'default', rendererOptions: { clearOutput: false, collapseSubtasks: false } });
  let fixFailed = false;
  try {
    await listr.run();
  } catch {
    fixFailed = true;
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
