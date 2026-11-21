import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logInfo, logSuccess } from '../lib/logger.js';

const DEFAULT_GITIGNORE = [
  '# Generados por iteraciones (build y caché)',
  'dist/',
  '.iteraciones/',
  'node_modules/',

  'build.sh',
  '.DS_Store',

  '# diffs de los snapshots: se regeneran con iteraciones snapshots check',
  'diff/',
  '',
].join('\n');

type GitignoreResult = 'creado' | 'actualizado' | 'sin-cambios';

async function writeGitignore(cwd: string): Promise<GitignoreResult> {
  const ruta = join(cwd, '.gitignore');
  const existente = await Bun.file(ruta)
    .text()
    .catch(() => null);
  if (existente === null) {
    await writeFile(ruta, DEFAULT_GITIGNORE);
    return 'creado';
  }
  const lineas = existente.split(/\r?\n/).map((linea) => linea.trim());
  if (lineas.includes('node_modules/') || lineas.includes('node_modules')) return 'sin-cambios';
  const eol = existente.includes('\r\n') ? '\r\n' : '\n';
  const base = existente === '' || existente.endsWith('\n') ? existente : `${existente}${eol}`;
  await writeFile(ruta, `${base}node_modules/${eol}`);
  return 'actualizado';
}

export function report(created: boolean, archivo: string, context = 'create'): void {
  if (created) logSuccess(`creado ${archivo}`, context);
  else logInfo(`omitido ${archivo} (ya existe)`, context);
}

export async function ensureGitignore(cwd: string, context = 'create'): Promise<void> {
  const gitignore = await writeGitignore(cwd);
  if (gitignore === 'actualizado') logSuccess('actualizado .gitignore (node_modules/)', context);
  else if (gitignore === 'creado') logSuccess('creado .gitignore', context);
  else logInfo('omitido .gitignore (ya existe)', context);
}
