import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const XMP_TEMPLATE_RESOURCE = join(import.meta.dir, '../lib/resources/xmp/pdfx.xmp');

export async function preparePaths(dirs: string[], xmpDirs: string[]): Promise<void> {
  for (const dir of new Set([...dirs, ...xmpDirs])) await mkdir(dir, { recursive: true });
  if (!(await Bun.file(XMP_TEMPLATE_RESOURCE).exists())) return;
  for (const dir of xmpDirs) await copyFile(XMP_TEMPLATE_RESOURCE, join(dir, 'pdfx.xmp'));
}

export function xmpDirsFor(dirs: string[]): string[] {
  return existsSync(XMP_TEMPLATE_RESOURCE) ? dirs : [];
}
