import { access, constants, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkPandoc as pandocVersion } from '../../services/pandoc-runner.js';
import { run } from '../../services/run.js';

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
  const fixAction = async (): Promise<string> => {
    const proc = Bun.spawn(['bun', 'add', '-d', '@tailwindcss/cli'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    await proc.exited;
    return 'instalado @tailwindcss/cli';
  };

  try {
    const proc = Bun.spawn(['bun', 'x', '--bun', '@tailwindcss/cli', '--help'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { label: '@tailwindcss/cli disponible', ok: true };
    }
    // bun x terminó con error: el paquete no está disponible o está roto.
    return {
      label: '@tailwindcss/cli disponible',
      ok: false,
      detail: '@tailwindcss/cli no ejecutable',
      fixAction,
    };
  } catch {
    return {
      label: '@tailwindcss/cli disponible',
      ok: false,
      detail: '@tailwindcss/cli no encontrado. Instálalo con: bun add -d @tailwindcss/cli',
      fixAction,
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
  let canWrite = false;
  try {
    await writeFile(probe, '');
    canWrite = true;
  } catch {
    return { label: 'permisos de escritura en cwd', ok: false, detail: `sin permisos de escritura en ${cwd}` };
  } finally {
    // Limpiar el archivo probe independientemente de lo que ocurra después.
    await unlink(probe).catch(() => undefined);
  }
  return { label: 'permisos de escritura en cwd', ok: canWrite };
}

/**
 * Verifica que el motor LaTeX (xelatex por defecto) y la clase KOMA-Script
 * estén disponibles en el sistema.
 *
 * Función de propósito general: puede usarse tanto en el comando `doctor`
 * (donde el resultado es informacional y no bloquea el build) como en
 * `validate` (donde un resultado negativo se trata como error bloqueante).
 * La semántica de informacional vs. bloqueante la determina cada punto de uso.
 *
 * @param engine Motor LaTeX a verificar ('xelatex' o 'lualatex').
 */
export async function checkLatexEngine(engine: 'xelatex' | 'lualatex' = 'xelatex'): Promise<CheckResult> {
  try {
    const engineResult = await run(engine, ['--version']);
    if (engineResult.exitCode !== 0) {
      return {
        label: `${engine} disponible`,
        ok: false,
        detail: `${engine} no encontrado en PATH. Instala MacTeX: https://tug.org/mactex/`,
      };
    }
    // Verificar que KOMA-Script esté instalado (scrartcl.cls).
    let komaOk = false;
    try {
      const komaResult = await run('kpsewhich', ['scrartcl.cls']);
      komaOk = komaResult.exitCode === 0 && komaResult.stdout.trim().length > 0;
    } catch {
      komaOk = false;
    }
    if (!komaOk) {
      return {
        label: `${engine} disponible`,
        ok: false,
        detail: `${engine} encontrado pero KOMA-Script no instalado. Instala MacTeX full: https://tug.org/mactex/`,
      };
    }
    const versionLine = engineResult.stdout.split('\n')[0]?.trim() ?? engine;
    return { label: `${engine} disponible`, ok: true, detail: versionLine };
  } catch {
    return {
      label: `${engine} disponible`,
      ok: false,
      detail: `${engine} no encontrado en PATH. Instala MacTeX: https://tug.org/mactex/`,
    };
  }
}

export async function checkPdftoppm(): Promise<CheckResult> {
  try {
    const proc = Bun.spawn(['pdftoppm', '-v'], { stdout: 'pipe', stderr: 'pipe' });
    // Leer stderr en paralelo con proc.exited para evitar bloqueos si la salida llena el buffer.
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    // pdftoppm -v escribe en stderr y sale con código 0 o 99 según la versión
    if (exitCode === 0 || exitCode === 99) {
      const version = stderr.split('\n')[0]?.trim() ?? 'pdftoppm';
      return { label: 'pdftoppm disponible (portadas)', ok: true, detail: version };
    }
    return {
      label: 'pdftoppm disponible (portadas)',
      ok: false,
      detail: 'pdftoppm no ejecutable. Instala poppler: macOS → brew install poppler | Debian/Ubuntu → apt install poppler-utils',
    };
  } catch {
    return {
      label: 'pdftoppm disponible (portadas)',
      ok: false,
      detail: 'pdftoppm no encontrado en PATH. Instala poppler: macOS → brew install poppler | Debian/Ubuntu → apt install poppler-utils',
    };
  }
}
