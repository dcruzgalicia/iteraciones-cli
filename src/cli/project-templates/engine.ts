import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeExclusive } from '../../builder/pipeline-io.js';
import { logSuccess } from '../../lib/logger.js';
import { ensureGitignore, report } from '../project-files.js';

export interface ProjectTemplate {
  config: string;
  dirs: string[];
  files: Record<string, string>;
}

export function MENU(links: Array<{ name: string; url: string }>): string {
  return ['---', 'type: menu', 'title: Menú', 'links:', ...links.map((l) => `  - name: ${l.name}\n    url: ${l.url}`), '---', ''].join('\n');
}

export async function writeTemplate(cwd: string, name: string, template: ProjectTemplate): Promise<void> {
  await ensureGitignore(cwd, 'create');

  await Promise.all(template.dirs.map((dir) => mkdir(join(cwd, dir), { recursive: true })));

  report(await writeExclusive(join(cwd, 'iteraciones.config.yaml'), template.config), 'iteraciones.config.yaml');
  for (const [archivo, contenido] of Object.entries(template.files)) {
    report(await writeExclusive(join(cwd, archivo), contenido), archivo);
  }

  logSuccess(`plantilla "${name}" lista. Ejecuta 'iteraciones build'.`, 'create');
}
