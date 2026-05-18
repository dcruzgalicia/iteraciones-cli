import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { VALID_TYPES } from '../builder/pipeline/type-graph.js';
import type { DocumentType, Region } from '../builder/types.js';
import { VALID_REGIONS } from '../builder/types.js';

/**
 * Frontmatter mínimo correcto por tipo de documento.
 * La fecha se sustituye en tiempo de ejecución por la fecha actual.
 */
function minimalFrontmatter(type: DocumentType, opts: { region?: string } = {}): string {
  const today = new Date().toISOString().slice(0, 10);

  let base: string;
  switch (type) {
    case 'file':
      base = `---\ntitle: ''\ndate: ${today}`;
      break;
    case 'collection':
      base = `---\ntitle: ''\ntype: collection\nitems: []`;
      break;
    case 'author':
      base = `---\ntitle: ''\ntype: author`;
      break;
    case 'event':
      base = `---\ntitle: ''\ntype: event\ndate: ${today}`;
      break;
    case 'authors':
      base = `---\ntitle: ''\ntype: authors`;
      break;
    case 'events':
      base = `---\ntitle: ''\ntype: events`;
      break;
    case 'menu':
      base = `---\ntitle: ''\ntype: menu\nnav: []`;
      break;
    case 'card':
      base = `---\ntitle: ''\ntype: card`;
      break;
    case 'list':
      base = `---\ntitle: ''\ntype: list`;
      break;
  }

  // Si se indica region, el documento es un bloque. Se antepone block:true y region:
  // independientemente del tipo base para que iteraciones new card foo.md --region sidebar-primary
  // produzca un bloque de tipo card, que es el comportamiento esperado.
  if (opts.region) {
    return `${base}\nblock: true\nregion: ${opts.region}\n---\n\n`;
  }

  return `${base}\n---\n\n`;
}

/**
 * Crea un archivo Markdown con el frontmatter mínimo correcto para el tipo dado.
 * Si el archivo ya existe, lo omite e informa al usuario.
 *
 * @param cwd   Directorio raíz del proyecto.
 * @param type  DocumentType del nuevo documento.
 * @param path  Ruta relativa del archivo a crear (incluye `.md`).
 * @param opts  Opciones adicionales: `region` para bloques.
 */
export async function runNew(cwd: string, type: string, path: string, opts: { region?: string } = {}): Promise<void> {
  // Validar tipo
  if (!VALID_TYPES.has(type as DocumentType)) {
    process.stderr.write(`Error: tipo "${type}" no válido.\nTipos disponibles: ${[...VALID_TYPES].join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  // Validar region si se proporcionó
  if (opts.region && !VALID_REGIONS.has(opts.region as Region)) {
    process.stderr.write(`Error: región "${opts.region}" no válida.\nRegiones disponibles: ${[...VALID_REGIONS].join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

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

  const content = minimalFrontmatter(type as DocumentType, opts);

  // Crear con bandera exclusiva (wx) para garantizar que no se sobreescribe aunque
  // otro proceso cree el archivo entre la comprobación y la escritura (TOCTOU).
  try {
    await writeFile(absPath, content, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`new: creado ${normalizedPath} (type: ${type})\n`);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      process.stdout.write(`new: omitido ${normalizedPath} (ya existe)\n`);
      return;
    }
    process.stderr.write(`Error al crear "${normalizedPath}": ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
