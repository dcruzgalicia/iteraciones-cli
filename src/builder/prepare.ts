import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const XMP_TEMPLATE_RESOURCE = join(import.meta.dir, '../lib/resources/xmp/pdfx.xmp');

/**
 * Preparación que los comandos externos dan por hecha: los directorios en los
 * que van a escribir y la plantilla XMP del paquete junto al .tex de trabajo.
 * El build y `iteraciones prepare` pasan por aquí, así que el `.sh` prepara
 * exactamente lo mismo que preparó TypeScript.
 */
export async function preparePaths(dirs: string[], xmpDirs: string[]): Promise<void> {
  for (const dir of new Set([...dirs, ...xmpDirs])) await mkdir(dir, { recursive: true });
  if (!(await Bun.file(XMP_TEMPLATE_RESOURCE).exists())) return;
  for (const dir of xmpDirs) await copyFile(XMP_TEMPLATE_RESOURCE, join(dir, 'pdfx.xmp'));
}

/** Los dirs que sí van a recibir la plantilla XMP, según exista en el paquete. */
export function xmpDirsFor(dirs: string[]): string[] {
  return existsSync(XMP_TEMPLATE_RESOURCE) ? dirs : [];
}
