import { checkBiber, checkLatexEngine, checkMagick, checkPandoc, checkPdfCheck, checkPdfToPpm } from '../cli/doctor/system-checks.js';

function existe(bin: string, args: string[]): Promise<boolean> {
  return Bun.spawn([bin, ...args], { stdout: 'ignore', stderr: 'ignore' })
    .exited.then((code) => code === 0)
    .catch(() => false);
}

export async function missingTools(): Promise<string[]> {
  const checks = await Promise.all([checkPandoc(), checkLatexEngine(), checkMagick(), checkPdfToPpm(), checkPdfCheck(), checkBiber()]);
  const extras = await Promise.all([existe('unzip', ['-v']), existe('pdftotext', ['-v']), existe('git', ['--version'])]);
  const nombres = ['unzip', 'pdftotext', 'git'];
  const faltan = checks.filter((c) => !c.ok).map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  extras.forEach((ok, i) => {
    if (!ok) faltan.push(nombres[i] ?? '');
  });
  return faltan;
}

export async function reportMissingTools(): Promise<boolean> {
  const faltan = await missingTools();
  if (faltan.length === 0) return false;
  process.stderr.write(`\nFaltan herramientas para correr la suite:\n${faltan.map((f) => `  - ${f}`).join('\n')}\n\n`);
  return true;
}
