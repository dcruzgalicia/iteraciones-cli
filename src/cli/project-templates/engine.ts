import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeExclusive } from '../../builder/pipeline-io.js';
import { logInfo, logSuccess } from '../../lib/logger.js';
import { initProject } from '../init.js';

export interface ProjectTemplate {
  config: string;
  dirs: string[];
  files: Record<string, string>;
}

export function MENU(links: Array<{ name: string; url: string }>): string {
  return ['---', 'type: menu', 'title: Menú', 'links:', ...links.map((l) => `  - name: ${l.name}\n    url: ${l.url}`), '---', ''].join('\n');
}

export async function writeTemplate(cwd: string, name: string, template: ProjectTemplate): Promise<void> {
  await initProject(cwd);

  await Promise.all(template.dirs.map((dir) => mkdir(join(cwd, dir), { recursive: true })));

  const report = (created: boolean, archivo: string): void => {
    if (created) logSuccess(`creado ${archivo}`, 'init');
    else logInfo(`omitido ${archivo} (ya existe)`, 'init');
  };

  report(await writeExclusive(join(cwd, 'iteraciones.config.yaml'), template.config), 'iteraciones.config.yaml');
  for (const [archivo, contenido] of Object.entries(template.files)) {
    report(await writeExclusive(join(cwd, archivo), contenido), archivo);
  }

  logSuccess(`plantilla "${name}" lista. Ejecuta 'iteraciones build'.`, 'init');
}
