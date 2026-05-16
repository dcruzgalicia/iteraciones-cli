import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Ejemplo de configuración mínima; loadSiteConfig usa valores por defecto
// cuando este archivo no existe o le faltan campos.
const DEFAULT_CONFIG = `site:
  title: "Mi sitio"
  tagline: "escribir, compartir, re-existir"
  lang: "es"
`;

const DEFAULT_README = `---
title: Inicio
---

# Inicio

Escribe tu contenido aquí.
`;

/**
 * Crea \`_iteraciones.yaml\` y \`README.md\` mínimos en el directorio indicado.
 * Si alguno de los archivos ya existe, lo omite e informa al usuario.
 */
export async function runInit(cwd: string): Promise<void> {
  const [configCreated, readmeCreated] = await Promise.all([
    createExclusive(join(cwd, '_iteraciones.yaml'), DEFAULT_CONFIG),
    createExclusive(join(cwd, 'README.md'), DEFAULT_README),
  ]);

  process.stdout.write(configCreated ? 'init: creado _iteraciones.yaml\n' : 'init: omitido _iteraciones.yaml (ya existe)\n');
  process.stdout.write(readmeCreated ? 'init: creado README.md\n' : 'init: omitido README.md (ya existe)\n');
}

/**
 * Intenta crear el archivo con la bandera exclusiva \`wx\`.
 * Retorna true si se creó, false si ya existía (EEXIST).
 * Re-lanza cualquier otro error (EACCES, ENOTDIR, etc.).
 */
async function createExclusive(filePath: string, content: string): Promise<boolean> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}
