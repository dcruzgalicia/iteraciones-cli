import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { VALID_TYPES } from '../builder/pipeline/type-graph.js';
import type { DocumentType, Region } from '../builder/types.js';
import { VALID_REGIONS } from '../builder/types.js';

/**
 * Frontmatter mínimo correcto por tipo de documento.
 * La fecha se sustituye en tiempo de ejecución por la fecha actual.
 */
function minimalFrontmatter(type: DocumentType, opts: { region?: string } = {}): string {
  const today = new Date().toISOString().slice(0, 10);

  switch (type) {
    case 'file':
      return `---\ntitle: ''\ndate: ${today}\n---\n\n`;
    case 'collection':
      return `---\ntitle: ''\ntype: collection\nitems: []\n---\n\n`;
    case 'author':
      return `---\ntitle: ''\ntype: author\n---\n\n`;
    case 'event':
      return `---\ntitle: ''\ntype: event\ndate: ${today}\n---\n\n`;
    case 'authors':
      return `---\ntitle: ''\ntype: authors\n---\n\n`;
    case 'events':
      return `---\ntitle: ''\ntype: events\n---\n\n`;
    case 'menu':
      return `---\ntitle: ''\ntype: menu\nnav: []\n---\n\n`;
    case 'card':
      return `---\ntitle: ''\ntype: card\n---\n\n`;
    case 'list':
      return `---\ntitle: ''\ntype: list\n---\n\n`;
    default: {
      // Bloque con tipo: detectado cuando se pasa --block implícitamente.
      const region = opts.region ?? 'content-before';
      return `---\ntitle: ''\ntype: ${type}\nblock: true\nregion: ${region}\n---\n\n`;
    }
  }
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
  const absPath = join(cwd, normalizedPath);

  // Crear directorio si no existe
  await mkdir(dirname(absPath), { recursive: true });

  const content = minimalFrontmatter(type as DocumentType, opts);

  // Crear con flag exclusiva (no sobrescribir)
  try {
    const file = Bun.file(absPath);
    if (await file.exists()) {
      process.stdout.write(`new: omitido ${normalizedPath} (ya existe)\n`);
      return;
    }
    await Bun.write(absPath, content);
    process.stdout.write(`new: creado ${normalizedPath} (type: ${type})\n`);
  } catch (err) {
    process.stderr.write(`Error al crear "${normalizedPath}": ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
