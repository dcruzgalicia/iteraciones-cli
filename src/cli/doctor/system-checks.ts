import { access, constants, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkPandoc as pandocVersion } from '../../services/pandoc-runner.js';

export type CheckResult = {
  label: string;
  ok: boolean;
  detail?: string;
  fixAction?: () => Promise<string>;
};

export async function checkPandoc(): Promise<CheckResult> {
  try {
    const version = await pandocVersion();
    // pandocVersion retorna "pandoc X.Y.Z"; verificar versión mínima 3.0
    const match = version.match(/pandoc\s+([\d.]+)/i);
    const versionStr = match?.[1] ?? '';
    const ok = versionStr.localeCompare('3.0', undefined, { numeric: true }) >= 0;
    return {
      label: 'pandoc instalado',
      ok,
      detail: ok ? version : `${version} — se recomienda 3.0+`,
    };
  } catch {
    return {
      label: 'pandoc instalado',
      ok: false,
      detail: 'pandoc no encontrado en PATH. Instálalo desde https://pandoc.org/installing.html',
    };
  }
}

export async function checkTailwind(cwd: string): Promise<CheckResult> {
  try {
    const proc = Bun.spawn(['bun', 'x', '--bun', '@tailwindcss/cli', '--help'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    return {
      label: '@tailwindcss/cli disponible',
      ok: exitCode === 0,
      detail: exitCode === 0 ? undefined : '@tailwindcss/cli no ejecutable',
    };
  } catch {
    return {
      label: '@tailwindcss/cli disponible',
      ok: false,
      detail: '@tailwindcss/cli no encontrado. Instálalo con: bun add -d @tailwindcss/cli',
      fixAction: async () => {
        const proc = Bun.spawn(['bun', 'add', '-d', '@tailwindcss/cli'], { cwd, stdout: 'pipe', stderr: 'pipe' });
        await proc.exited;
        return 'instalado @tailwindcss/cli';
      },
    };
  }
}

export async function checkReadPermissions(cwd: string): Promise<CheckResult> {
  try {
    await access(cwd, constants.R_OK);
    return { label: 'permisos de lectura en cwd', ok: true };
  } catch {
    return { label: 'permisos de lectura en cwd', ok: false, detail: `sin permisos de lectura en ${cwd}` };
  }
}

export async function checkWritePermissions(cwd: string): Promise<CheckResult> {
  const probe = join(cwd, `.iteraciones-doctor-probe-${Date.now()}`);
  try {
    await writeFile(probe, '');
    await unlink(probe);
    return { label: 'permisos de escritura en cwd', ok: true };
  } catch {
    return { label: 'permisos de escritura en cwd', ok: false, detail: `sin permisos de escritura en ${cwd}` };
  }
}
