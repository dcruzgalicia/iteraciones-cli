import type { TemplateContext } from '../../template/render/context.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';

/**
 * Resuelve los ponentes de un evento combinando los nombres del frontmatter
 * con el AuthorDocumentIndex. Para cada entrada en `frontmatter.speakers`:
 *   - Si es un string y existe un documento de tipo `author` con ese título en
 *     el índice, devuelve { title, href (root-relative), body } de ese documento.
 *   - Si es un objeto { title, href?, body? }, utiliza sus campos y enriquece con
 *     el índice solo cuando el campo correspondiente esté vacío.
 *   - Si el string no tiene coincidencia en el índice, devuelve solo { title: nombre }.
 */
type SpeakerDefinition = string | { title: string; href?: string; body?: string };

function resolveSpeakers(
  speakers: SpeakerDefinition[],
  authorIndex: AuthorDocumentIndex,
  docRelativePath: string,
): Array<{ title: string; href: string | undefined; body: string | undefined }> {
  return speakers
    .map((speaker) => {
      if (typeof speaker === 'string') {
        const name = speaker.trim();
        if (!name) return undefined;
        const key = name.toLowerCase();
        const authorDoc = authorIndex.get(key);
        if (authorDoc && authorDoc.relativePath !== docRelativePath) {
          return {
            title: authorDoc.frontmatter.title,
            href: `/${authorDoc.relativePath.replace(/\.md$/, '.html')}`,
            body: authorDoc.htmlFragment ?? '',
          };
        }
        return { title: name, href: undefined, body: undefined };
      }

      const title = speaker.title.trim();
      if (!title) return undefined;
      const key = title.toLowerCase();
      const authorDoc = authorIndex.get(key);
      return {
        title,
        href:
          speaker.href?.trim() ||
          (authorDoc && authorDoc.relativePath !== docRelativePath ? `/${authorDoc.relativePath.replace(/\.md$/, '.html')}` : undefined),
        body: speaker.body?.trim() || (authorDoc && authorDoc.relativePath !== docRelativePath ? (authorDoc.htmlFragment ?? undefined) : undefined),
      };
    })
    .filter((speaker): speaker is { title: string; href: string | undefined; body: string | undefined } => speaker !== undefined);
}

/**
 * Construye el TemplateContext para un documento de tipo `event`.
 *
 * Variables producidas para `templates/event.html` (título, autor, cuerpo)
 * y `layouts/default.html` (sidebar: speakers como sección "Participan"):
 *   title      → frontmatter.title
 *   pagetitle  → frontmatter.title
 *   author     → frontmatter.author (unido con ', ')
 *   body       → htmlFragment del documento (descripción opcional)
 *   time       → frontmatter.time (string opcional)
 *   location   → frontmatter.location (string opcional)
 *   modality   → frontmatter.modality (string opcional)
 *   speakers   → array de { title, href, body } resueltos desde AuthorDocumentIndex
 *                (siempre incluye href y body, aunque sean undefined, para evitar
 *                 herencia del contexto padre en el loop $for(speakers)$)
 */
export function buildEventContext(doc: BuildDocument, authorIndex: AuthorDocumentIndex): TemplateContext {
  const speakers = resolveSpeakers(doc.frontmatter.speakers, authorIndex, doc.relativePath);

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author.join(', '),
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
    href: `/${event.relativePath.replace(/\.md$/, '.html')}`,
    title: event.frontmatter.title,
    date: event.frontmatter.date,
    body: event.htmlFragment ?? '',
    ...(typeof event.frontmatter.time === 'string' && { time: event.frontmatter.time }),
    ...(typeof event.frontmatter.location === 'string' && { location: event.frontmatter.location }),
    ...(typeof event.frontmatter.modality === 'string' && { modality: event.frontmatter.modality }),
    ...(event.frontmatter.author.length > 0 && { author: event.frontmatter.author.join(', ') }),
  }));

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
  };
}
