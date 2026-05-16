import { checkSiteConfig, checkTemplates } from './doctor/project-checks.js';
import { type CheckResult, checkPandoc, checkReadPermissions, checkTailwind, checkWritePermissions } from './doctor/system-checks.js';

/**
 * Verifica que el entorno tenga todo lo necesario para correr \`iteraciones build\`.
 * Con \`options.fix = true\` intenta corregir automáticamente los problemas reparables.
 */
export async function runDoctor(cwd: string, options: { fix?: boolean } = {}): Promise<void> {
  const checks = await Promise.all([
    checkPandoc(),
    checkSiteConfig(cwd),
    Promise.resolve(checkTemplates(cwd)),
    checkTailwind(cwd),
    checkReadPermissions(cwd),
    checkWritePermissions(cwd),
  ]);

  const lines = checks.map((c) => {
    const icon = c.ok ? '✔' : '✖';
    const detail = c.detail ? `  ${c.detail}` : '';
    return `  ${icon} ${c.label}${detail}`;
  });

  const allOk = checks.every((c) => c.ok);

  if (!options.fix) {
    process.stdout.write(`doctor:\n${lines.join('\n')}\n\n`);
    process.stdout.write(allOk ? 'Todo en orden.\n' : 'Hay problemas que corregir.\n');
    if (!allOk) process.exitCode = 1;
    return;
  }

  const fixable = checks.filter((c): c is CheckResult & { fixAction: () => Promise<string> } => !c.ok && c.fixAction != null);
  const fixResults = await Promise.allSettled(
    fixable.map(async (c) => {
      const msg = await c.fixAction();
      return `  ↻ ${c.label}: ${msg}`;
    }),
  );
  const fixLines = fixResults.map((r) => (r.status === 'fulfilled' ? r.value : '  ✖ error al intentar corrección'));
  const fixSection = fixLines.length > 0 ? `\ncorrecciones:\n${fixLines.join('\n')}\n` : '';
  const summary = allOk
    ? 'Todo en orden.\n'
    : fixLines.length > 0
      ? 'Correcciones aplicadas. Ejecuta doctor de nuevo para verificar.\n'
      : 'Hay problemas sin corrección automática disponible.\n';

  process.stdout.write(`doctor:\n${lines.join('\n')}\n${fixSection}\n${summary}`);
  if (!allOk) process.exitCode = 1;
}
