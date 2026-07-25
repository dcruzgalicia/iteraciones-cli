import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

/**
 * Crea un archivo Markdown con frontmatter mínimo.
 */
export async function runNew(cwd: string, path: string): Promise<void> {
  // Normalizar ruta: añadir .md si no lo tiene
  const normalizedPath = path.endsWith('.md') ? path : `${path}.md`;

  // Rechazar rutas absolutas o con escalada de directorio (../../../etc).
  if (isAbsolute(normalizedPath) || normalize(normalizedPath).startsWith('..')) {
    process.stderr.write(`Error: la ruta debe ser relativa al directorio del proyecto (recibido: "${path}")\n`);
    process.exitCode = 1;
    return;
  }

  const absPath = join(cwd, normalizedPath);

  // Crear directorio si no existe
  await mkdir(dirname(absPath), { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const content = `---\ntitle: ''\ndate: ${today}\n---\n\n`;

  try {
    await writeFile(absPath, content, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`new: creado ${normalizedPath}\n`);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      process.stdout.write(`new: omitido ${normalizedPath} (ya existe)\n`);
      return;
    }
    process.stderr.write(`Error al crear "${normalizedPath}": ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
