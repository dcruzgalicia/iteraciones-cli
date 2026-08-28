import { access, constants, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectMagick } from '../../builder/image-processor.js';
import { resolvePdfCheckBinary } from '../../builder/pdfx-check.js';
import { getPandocVersion } from '../../lib/pandoc-runner.js';
import { exec } from '../../lib/run.js';

export type CheckResult = {
  label: string;
  ok: boolean;
  detail?: string;
  /**
   * Check opcional: se muestra con ⚠ si falla pero no rompe el exit code de
   * doctor (p. ej. pdftoppm — la portada del PDF es un extra, no un requisito).
   */
  warn?: boolean;
};

/** Versión mínima de Bun requerida por el proyecto. */
const MIN_BUN_VERSION = '1.2.0';

export function checkBunVersion(): CheckResult {
  const version = Bun.version;
  const ok = version.localeCompare(MIN_BUN_VERSION, undefined, { numeric: true }) >= 0;
  return {
    label: 'bun instalado',
    ok,
    detail: ok ? `v${version}` : `v${version} — se requiere >= ${MIN_BUN_VERSION}`,
  };
}

export async function checkPandoc(): Promise<CheckResult> {
  try {
    const version = await getPandocVersion();
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
  } catch (err) {
    // Un directorio inexistente no es un problema de permisos: distinguir
    // ENOENT de EACCES evita el diagnóstico falso de "sin permisos".
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        label: 'permisos de lectura en cwd',
        ok: false,
        detail: `el directorio ${cwd} no existe`,
      };
    }
    // Error esperado: EACCES en access(); el detalle accionable ya se reporta
    return {
      label: 'permisos de lectura en cwd',
      ok: false,
      detail: `sin permisos de lectura en ${cwd}`,
    };
  }
}

export async function checkWritePermissions(cwd: string): Promise<CheckResult> {
  // El mkdir recursivo del probe crearía el árbol si el directorio no existe
  // (el probe reportaría éxito sobre un directorio recién creado): verificar
  // la existencia antes, con el mismo criterio que checkReadPermissions.
  try {
    await stat(cwd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        label: 'permisos de escritura en cwd',
        ok: false,
        detail: `el directorio ${cwd} no existe`,
      };
    }
  }
  // Escribir el probe dentro de .iteraciones/, el directorio de caché del build.
  // Si el proceso muere, el archivo queda en un directorio que se limpia con
  // clean o --full, no en la raíz del proyecto.
  const probeDir = join(cwd, '.iteraciones');
  const probe = join(probeDir, `doctor-probe-${Date.now()}`);
  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(probe, '');
    await unlink(probe);
    return { label: 'permisos de escritura en cwd', ok: true };
  } catch (err) {
    // Mismo criterio que checkReadPermissions: inexistencia ≠ permisos.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        label: 'permisos de escritura en cwd',
        ok: false,
        detail: `el directorio ${cwd} no existe`,
      };
    }
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
/**
 * Verifica que pdftoppm (poppler) esté disponible para la imagen de portada
 * del PDF (format.pdf.cover-image). Check opcional: un fallo no bloquea el
 * build (la portada se omite con warning) y tampoco falla doctor.
 */
export async function checkPdfToPpm(): Promise<CheckResult> {
  try {
    // pdftoppm imprime su versión en stderr (y en poppler reciente sale con
    // exit 1): basta con que el proceso se lance para considerar el binario
    // disponible, sin depender del exit code.
    const result = await exec('pdftoppm', ['-v']);
    const version = `${result.stdout}\n${result.stderr}`.split('\n')[0]?.trim() ?? 'pdftoppm';
    return { label: 'pdftoppm disponible', ok: true, detail: version, warn: true };
  } catch {
    // Error esperado: pdftoppm no está en PATH (ENOENT)
    return {
      label: 'pdftoppm disponible',
      ok: false,
      detail: 'pdftoppm no encontrado en PATH. Instala poppler (por ejemplo: brew install poppler)',
      warn: true,
    };
  }
}

/**
 * Verifica que el binario de validación PDF/X-1a (iteraciones-pdfcheck) esté
 * disponible: en el directorio gestionado (caché de usuario, `~/.cache/iteraciones/bin`)
 * o en PATH. Check opcional (warn): sin él el build genera los PDFs normalmente,
 * solo omite la certificación PDF/X-1a (y la CLI lo intenta compilar con cargo
 * si existe).
 */
export async function checkPdfCheck(): Promise<CheckResult> {
  const binary = await resolvePdfCheckBinary();
  if (!binary) {
    return {
      label: 'iteraciones-pdfcheck disponible',
      ok: false,
      detail:
        'no encontrado — la validación PDF/X-1a se omite. Instala Rust con rustup: https://doc.rust-lang.org/book/ch01-01-installation.html (el build lo compila) o descarga el precompilado de GitHub Releases',
      warn: true,
    };
  }
  try {
    const result = await exec(binary, ['--version']);
    const version = result.stdout.trim();
    return { label: 'iteraciones-pdfcheck disponible', ok: true, detail: version, warn: true };
  } catch {
    return {
      label: 'iteraciones-pdfcheck disponible',
      ok: false,
      detail: 'el binario no responde; elimínalo de la caché (~/.cache/iteraciones/bin) para que el build lo reconstruya',
      warn: true,
    };
  }
}

export async function checkLatexEngine(): Promise<CheckResult> {
  try {
    const engineResult = await exec('pdflatex', ['--version']);
    if (engineResult.exitCode !== 0) {
      return {
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex no encontrado en PATH. Instala MacTeX full: https://tug.org/mactex/',
      };
    }
    // Verificar que KOMA-Script esté instalado (scrartcl.cls).
    let komaOk = false;
    try {
      const komaResult = await exec('kpsewhich', ['scrartcl.cls']);
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
    // El PDF real se compila con latexmk (no con pdflatex directo): verificarlo
    // evita que doctor diga "todo en orden" y el build reviente después.
    let latexmkOk = false;
    try {
      const latexmkResult = await exec('latexmk', ['-v']);
      latexmkOk = latexmkResult.exitCode === 0;
    } catch {
      latexmkOk = false;
    }
    if (!latexmkOk) {
      return {
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex y KOMA-Script encontrados pero latexmk no está en PATH. Instala MacTeX full: https://tug.org/mactex/',
      };
    }
    const versionLine = engineResult.stdout.split('\n')[0]?.trim() ?? 'pdflatex';
    return { label: 'pdflatex disponible', ok: true, detail: versionLine };
  } catch {
    // Error esperado: pdflatex no está en PATH (ENOENT); el detalle accionable ya se reporta
    return {
      label: 'pdflatex disponible',
      ok: false,
      detail: 'pdflatex no encontrado en PATH. Instala MacTeX full: https://tug.org/mactex/',
    };
  }
}

/**
 * Verifica que ImageMagick v7 (`magick`) esté disponible para el
 * preprocesamiento de imágenes (CMYK 300dpi JPG). Check opcional (warn):
 * sin él las imágenes no se preprocesan y se usan las originales.
 */
export async function checkMagick(): Promise<CheckResult> {
  const ok = await detectMagick();
  if (ok) {
    return { label: 'ImageMagick disponible', ok: true, warn: true };
  }
  return {
    label: 'ImageMagick disponible',
    ok: false,
    detail: 'magick no encontrado en PATH. Instala ImageMagick (por ejemplo: brew install imagemagick). Las imágenes no se preprocesarán a CMYK.',
    warn: true,
  };
}

/**
 * biber: backend de citas de biblatex (la doc del flujo PDF lo requiere
 * cuando el proyecto tiene bibliografía, #2184). Check condicional: el
 * llamador solo lo ejecuta cuando hay bibliografía + PDF activos.
 *
 * Presencia vía PATH (Bun.which), sin ejecutar el binario: `biber --version`
 * tarda decenas de segundos por el arranque de Perl y doctor no debe
 * penalizarse; el build fallará con mensaje propio si el binario no sirve.
 */
export function checkBiber(): CheckResult {
  const path = Bun.which('biber');
  if (path) {
    return { label: 'biber disponible', ok: true, detail: path, warn: true };
  }
  return {
    label: 'biber disponible',
    ok: false,
    detail:
      'no encontrado — las citas PDF con biblatex fallarán al compilar. Viene con TeX Live/MacTeX full (tlmgr install biber) o: https://github.com/plk/biber',
    warn: true,
  };
}
