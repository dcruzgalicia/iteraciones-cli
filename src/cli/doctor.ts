import { Listr } from 'listr2';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../lib/errors.js';
import {
  type CheckResult,
  checkLatexEngine,
  checkPandoc,
  checkReadPermissions,
  checkTailwind,
  checkWritePermissions,
} from './doctor/system-checks.js';

async function checkSiteConfig(cwd: string): Promise<CheckResult> {
  try {
    await loadSiteConfig(cwd);
    return { label: 'iteraciones.config.yaml', ok: true };
  } catch (err) {
    if (err instanceof ConfigError) {
      return { label: 'iteraciones.config.yaml', ok: false, detail: err.message };
    }
    return { label: 'iteraciones.config.yaml', ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Verifica que el entorno tenga todo lo necesario para correr `iteraciones build`.
 * Con `options.fix = true` intenta corregir automáticamente los problemas reparables.
 */
export async function runDoctor(cwd: string, options: { fix?: boolean } = {}): Promise<void> {
  const checks = await Promise.all([
    checkPandoc(),
    checkSiteConfig(cwd),
    checkTailwind(cwd),
    checkReadPermissions(cwd),
    checkWritePermissions(cwd),
    checkLatexEngine(),
  ]);

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

    process.stdout.write(allOk ? '\nTodo en orden.\n' : '\nHay problemas que corregir.\n');
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
    process.stdout.write('\nCorrecciones aplicadas. Ejecuta doctor de nuevo para verificar.\n');
  } else if (stillBroken) {
    process.stdout.write(fixable.length > 0 ? '\nHay problemas sin corrección automática disponible.\n' : '\nHay problemas que corregir.\n');
  } else {
    process.stdout.write('\nTodo en orden.\n');
  }

  if (stillBroken) process.exitCode = 1;
}
