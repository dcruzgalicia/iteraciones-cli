import { MENU, type ProjectTemplate } from './engine.js';

const CONFIG = `# Repositorio: metadatos, licencias y catálogo ordenado por título.
# ponytail: la búsqueda y las facetas dependen de #2817/#2818
# (format.html.site.search); no se activan aquí hasta que el schema las acepte.
language: es-MX
toc: false
showDate: true
license: CC-BY-NC-ND-4.0
publisher: Mi repositorio
rights: Consulta la licencia de cada documento.
format:
  html:
    generate: true
    pageSize: 20
    site:
      title: Mi repositorio
      description: Documentos, metadatos y licencias
`;

export const REPOSITORIO: ProjectTemplate = {
  config: CONFIG,
  dirs: ['documentos', 'autoras', 'palabras-clave'],
  files: {
    'index.md': '---\ntitle: Catálogo\ntype: list\norder: title-asc\n---\n',
    'catalogo.md': '---\ntitle: Buscar en el catálogo\ntype: list\norder: title-asc\n---\n',
    'menu.md': MENU([
      { name: 'Inicio', url: './index.html' },
      { name: 'Catálogo', url: './catalogo.html' },
    ]),
    'documentos/.gitkeep': '',
    'autoras/.gitkeep': '',
    'palabras-clave/.gitkeep': '',
  },
};
