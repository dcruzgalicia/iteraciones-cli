import type { PluginDocumentEdge, PluginDocumentGraph } from '../plugin/types.js';

/**
 * Tipo mínimo requerido para construir el grafo de dependencias.
 * Compatible con BuildDocument y PluginDocumentSummary.
 */
type DocumentForGraph = {
  readonly relativePath: string;
  readonly type?: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
};

/**
 * Construye el grafo de dependencias entre documentos a partir del frontmatter.
 * No requiere render ni pandoc: solo usa los metadatos ya parseados.
 *
 * Aristas generadas:
 * - `'contains'`:    colección → cada ruta listada en `frontmatter.items`
 * - `'authored-by'`: documento con `frontmatter.author` → documento `author` correspondiente
 */
export function buildDocumentGraph(docs: ReadonlyArray<DocumentForGraph>): PluginDocumentGraph {
  const authorByName = new Map<string, string>();
  for (const doc of docs) {
    if (doc.type === 'author') {
      const name = String(doc.frontmatter['title'] ?? '')
        .toLowerCase()
        .trim();
      if (name && !authorByName.has(name)) authorByName.set(name, doc.relativePath);
    }
  }

  const edges: PluginDocumentEdge[] = [];
  for (const doc of docs) {
    if (doc.type === 'collection') {
      const items = doc.frontmatter['items'];
      if (Array.isArray(items)) {
        for (const item of items) {
          if (typeof item === 'string') {
            edges.push({ from: doc.relativePath, to: item, relation: 'contains' });
          }
        }
      }
    }
    const authors = doc.frontmatter['author'];
    if (Array.isArray(authors)) {
      for (const author of authors) {
        if (typeof author === 'string') {
          const authorPath = authorByName.get(author.toLowerCase().trim());
          if (authorPath) edges.push({ from: doc.relativePath, to: authorPath, relation: 'authored-by' });
        }
      }
    }
  }

  return { edges };
}
