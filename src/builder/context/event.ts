import type { TemplateContext } from '../../template/render/context.js';
import type { BuildDocument } from '../types.js';

/**
 * Normaliza el campo `speakers` del frontmatter a un array de objetos
 * con las propiedades que expone `templates/event.html`.
 *
 * Acepta tanto strings simples (nombre) como objetos YAML con campos
 * opcionales `href` y `body`.
 */
function normalizeSpeakers(raw: unknown): Array<{ title: string; href?: string; body?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === 'string') return { title: item };
    if (item !== null && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      return {
        title: typeof obj.title === 'string' ? obj.title : '',
        ...(typeof obj.href === 'string' && { href: obj.href }),
        ...(typeof obj.body === 'string' && { body: obj.body }),
      };
    }
    return { title: String(item) };
  });
}

/**
 * Construye el TemplateContext para un documento de tipo `event`.
 *
 * Variables producidas para `templates/event.html`:
 *   title      → frontmatter.title
 *   pagetitle  → frontmatter.title
 *   author     → frontmatter.author
 *   body       → htmlFragment del documento (descripción opcional)
 *   time       → frontmatter.time (string opcional)
 *   location   → frontmatter.location (string opcional)
 *   modality   → frontmatter.modality (string opcional)
 *   speakers   → array normalizado de { title, href?, body? } desde frontmatter.speakers
 */
export function buildEventContext(doc: BuildDocument): TemplateContext {
  const speakers = normalizeSpeakers(doc.frontmatter.speakers);

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author,
    body: doc.htmlFragment ?? '',
    ...(typeof doc.frontmatter.time === 'string' && { time: doc.frontmatter.time }),
    ...(typeof doc.frontmatter.location === 'string' && { location: doc.frontmatter.location }),
    ...(typeof doc.frontmatter.modality === 'string' && { modality: doc.frontmatter.modality }),
    ...(speakers.length > 0 && { speakers }),
  };
}

/**
 * Construye el TemplateContext para un documento de tipo `events`.
 *
 * Variables producidas para `templates/events.html`:
 *   title      → frontmatter.title
 *   pagetitle  → frontmatter.title
 *   author     → frontmatter.author
 *   body       → htmlFragment del documento (introducción opcional)
 *   list-items → array de eventos con { href, title, date, time?, location?, modality?, author? }
 *   count      → número de eventos
 */
export function buildEventsContext(doc: BuildDocument, eventDocs: BuildDocument[]): TemplateContext {
  const listItems = eventDocs.map((event) => ({
    href: event.relativePath.replace(/\.md$/, '.html'),
    title: event.frontmatter.title,
    date: event.frontmatter.date,
    ...(typeof event.frontmatter.time === 'string' && { time: event.frontmatter.time }),
    ...(typeof event.frontmatter.location === 'string' && { location: event.frontmatter.location }),
    ...(typeof event.frontmatter.modality === 'string' && { modality: event.frontmatter.modality }),
    ...(event.frontmatter.author && { author: event.frontmatter.author }),
  }));

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author,
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
  };
}
