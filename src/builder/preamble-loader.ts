import { join } from 'node:path';
import type { PdfFormatConfig } from '../config/site-config.js';

// ---------------------------------------------------------------------------
// Sistema de transpilers para el preámbulo LaTeX
// ---------------------------------------------------------------------------
// Cada transpiler vive en preamble/<prioridad>-<nombre>.ts y exporta:
//   description: string      → texto descriptivo
//   process(preamble: string[], config: PdfFormatConfig): string[]
//
// Pipeline:
//   buildLatexPreamble() → core preamble → transpilers → preamble final
//
// Los transpilers del proyecto en <cwd>/preamble/ con el mismo nombre
// reemplazan a los del paquete.
// ---------------------------------------------------------------------------

/** Ruta absoluta al directorio de preamble transpilers del paquete. */
const PKG_PREAMBLE_DIR = join(import.meta.dir, '../../preamble');

/** Lista de preamble transpilers empaquetados en orden de aplicación. */
export const BUILTIN_PREAMBLE_TRANSPILERS: string[] = [];

export interface PreambleTranspiler {
  description?: string;
  process(preamble: string[], config: PdfFormatConfig): string[];
}

export interface PreambleTranspilerInfo {
  name: string;
  description: string;
}

/**
 * Carga preamble transpilers desde el paquete y desde <cwd>/preamble/.
 * Los transpilers del proyecto con el mismo nombre reemplazan a los del paquete.
 * @param disabledList Lista de transpilers a desactivar (blacklist). undefined = todos activos.
 * @param cwd Directorio del proyecto para buscar overrides.
 */
export async function loadPreambleTranspilers(
  disabledList?: string[],
  cwd?: string,
): Promise<Array<{ name: string; process: (preamble: string[], config: PdfFormatConfig) => string[] }>> {
  const excluded = new Set(disabledList ?? []);
  const names = BUILTIN_PREAMBLE_TRANSPILERS.filter((n) => !excluded.has(n));

  const modules = new Map<string, PreambleTranspiler>();

  for (const name of names) {
    const mod = (await import(join(PKG_PREAMBLE_DIR, `${name}.ts`))) as PreambleTranspiler;
    modules.set(name, mod);
  }

  // Sobrescritura del proyecto: transpilers con el mismo nombre reemplazan
  if (cwd) {
    const projectDir = join(cwd, 'preamble');
    const projectDirExists = await Bun.file(projectDir)
      .exists()
      .catch(() => false);
    if (projectDirExists) {
      for (const name of names) {
        const projectPath = join(projectDir, `${name}.ts`);
        const exists = await Bun.file(projectPath)
          .exists()
          .catch(() => false);
        if (exists) {
          const mod = (await import(projectPath)) as PreambleTranspiler;
          modules.set(name, mod);
        }
      }
    }
  }

  const result: Array<{ name: string; process: (preamble: string[], config: PdfFormatConfig) => string[] }> = [];

  for (const name of names) {
    const mod = modules.get(name);
    if (!mod) continue;
    result.push({ name, process: mod.process.bind(mod) });
  }

  return result;
}

/** Retorna información de todos los preamble transpilers built-in. */
export function getBuiltinPreambleTranspilerInfos(): PreambleTranspilerInfo[] {
  return [];
}
