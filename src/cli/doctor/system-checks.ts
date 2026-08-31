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
  warn?: boolean;
};

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

export async function checkReadPermissions(cwd: string): Promise<CheckResult> {
  try {
    await access(cwd, constants.R_OK);
    return { label: 'permisos de lectura en cwd', ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        label: 'permisos de lectura en cwd',
        ok: false,
        detail: `el directorio ${cwd} no existe`,
      };
    }
    return {
      label: 'permisos de lectura en cwd',
      ok: false,
      detail: `sin permisos de lectura en ${cwd}`,
    };
  }
}

export async function checkWritePermissions(cwd: string): Promise<CheckResult> {
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
  const probeDir = join(cwd, '.iteraciones');
  const probe = join(probeDir, `doctor-probe-${Date.now()}`);
  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(probe, '');
    await unlink(probe);
    return { label: 'permisos de escritura en cwd', ok: true };
  } catch (err) {
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

export async function checkPdfToPpm(): Promise<CheckResult> {
  try {
    const result = await exec('pdftoppm', ['-v']);
    const version = `${result.stdout}\n${result.stderr}`.split('\n')[0]?.trim() ?? 'pdftoppm';
    return { label: 'pdftoppm disponible', ok: true, detail: version, warn: true };
  } catch {
    return {
      label: 'pdftoppm disponible',
      ok: false,
      detail: 'pdftoppm no encontrado en PATH. Instala poppler (por ejemplo: brew install poppler)',
      warn: true,
    };
  }
}

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
    let komaOk = false;
    try {
      const komaResult = await exec('kpsewhich', ['scrartcl.cls']);
      komaOk = komaResult.exitCode === 0 && komaResult.stdout.trim().length > 0;
    } catch {
      komaOk = false;
    }
    if (!komaOk) {
      return {
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex encontrado pero KOMA-Script no instalado. Instala MacTeX full: https://tug.org/mactex/',
      };
    }
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
    return {
      label: 'pdflatex disponible',
      ok: false,
      detail: 'pdflatex no encontrado en PATH. Instala MacTeX full: https://tug.org/mactex/',
    };
  }
}

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
