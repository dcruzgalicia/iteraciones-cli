import { access, constants, mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkPandoc as pandocVersion } from '../../lib/pandoc-runner.js';
import { run } from '../../lib/run.js';

export type CheckResult = {
  label: string;
  ok: boolean;
  detail?: string;
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
    // Error esperado: pandoc no está en PATH (ENOENT); el detalle accionable ya se reporta
    return {
      label: 'pandoc instalado',
      ok: false,
      detail: 'pandoc no encontrado en PATH. Instálalo desde https://pandoc.org/installing.html',
    };
  }
}

export async function checkReadPermissions(cwd: string): Promise<CheckResult> {
  try {
    await access(cwd, constants.R_OK);
    return { label: 'permisos de lectura en cwd', ok: true };
  } catch {
    // Error esperado: EACCES en access(); el detalle accionable ya se reporta
    return {
      label: 'permisos de lectura en cwd',
      ok: false,
      detail: `sin permisos de lectura en ${cwd}`,
    };
  }
}

export async function checkWritePermissions(cwd: string): Promise<CheckResult> {
  // Escribir el probe dentro de .iteraciones/, el directorio de caché del build.
  // Si el proceso muere, el archivo queda en un directorio que se limpia con
  // clean o --no-cache, no en la raíz del proyecto.
  const probeDir = join(cwd, '.iteraciones');
  const probe = join(probeDir, `doctor-probe-${Date.now()}`);
  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(probe, '');
    await unlink(probe);
    return { label: 'permisos de escritura en cwd', ok: true };
  } catch {
    return {
      label: 'permisos de escritura en cwd',
      ok: false,
      detail: `sin permisos de escritura en ${cwd}`,
    };
  }
}

/**
 * Verifica que el motor LaTeX (pdflatex) y la clase KOMA-Script
 * estén disponibles en el sistema.
 *
 * Función de propósito general: puede usarse tanto en el comando `doctor`
 * (donde el resultado es informacional y no bloquea el build) como en
 * `validate` (donde un resultado negativo se trata como error bloqueante).
 * La semántica de informacional vs. bloqueante la determina cada punto de uso.
 */
export async function checkLatexEngine(): Promise<CheckResult> {
  try {
    const engineResult = await run('pdflatex', ['--version']);
    if (engineResult.exitCode !== 0) {
      return {
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex no encontrado en PATH. Instala MacTeX: https://tug.org/mactex/',
      };
    }
    // Verificar que KOMA-Script esté instalado (scrartcl.cls).
    let komaOk = false;
    try {
      const komaResult = await run('kpsewhich', ['scrartcl.cls']);
      komaOk = komaResult.exitCode === 0 && komaResult.stdout.trim().length > 0;
    } catch {
      // kpsewhich no disponible o KOMA-Script ausente: lo reporta el check principal
      komaOk = false;
    }
    if (!komaOk) {
      return {
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex encontrado pero KOMA-Script no instalado. Instala MacTeX full: https://tug.org/mactex/',
      };
    }
    const versionLine = engineResult.stdout.split('\n')[0]?.trim() ?? 'pdflatex';
    return { label: 'pdflatex disponible', ok: true, detail: versionLine };
  } catch {
    // Error esperado: pdflatex no está en PATH (ENOENT); el detalle accionable ya se reporta
    return {
      label: 'pdflatex disponible',
      ok: false,
      detail: 'pdflatex no encontrado en PATH. Instala MacTeX: https://tug.org/mactex/',
    };
  }
}
